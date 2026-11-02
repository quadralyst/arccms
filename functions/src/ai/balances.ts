/**
 * A connection's balance, read with its own key (specs/ai-media-spec.md, AM-D32): DeepSeek's
 * account balance and what is left of an OpenRouter key's own limit. Read once a day by
 * cleanUpAi and when the admin clicks Refresh; stored on the connection in Settings/ai.
 * Below the admin's low mark, admins are told once, until the balance rises again.
 *
 * Balances that need an admin or management key are not read: such a key can do far more
 * than call a model, so Arc does not keep one. Written from the providers' docs as read on
 * 2026-11-02 and not tested live (AM-D34).
 */
import { db } from '../init.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';
import { readKey } from './keys.js';
import { findPreset } from './presets.js';
import { AI_SETTINGS_DOC, connectionAuth, connectionBaseUrl, type AiConnection } from './settings.js';

export type BalanceRead = { ok: true; balance: number | null; unit: string } | { ok: false; detail: string };

const TIMEOUT_MS = 15_000;

async function getJson(url: string, connection: AiConnection, key: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const auth = connectionAuth(connection);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(url, { headers: { accept: 'application/json', [auth.header]: `${auth.prefix}${key}` }, signal: controller.signal, redirect: 'error' });
        const raw = await response.text();
        let body: Record<string, unknown> = {};
        try {
            body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
            body = {};
        }
        return { status: response.status, body };
    } finally {
        clearTimeout(timer);
    }
}

/** DeepSeek: `GET /user/balance`, in USD when the account holds USD, else its first currency. */
export function readDeepSeekBalance(body: Record<string, unknown>): BalanceRead {
    const infos = Array.isArray(body['balance_infos']) ? (body['balance_infos'] as Array<Record<string, unknown>>) : [];
    const info = infos.find((i) => i['currency'] === 'USD') ?? infos[0];
    if (!info) return { ok: false, detail: 'DeepSeek gave no balance' };
    const balance = Number(info['total_balance']);
    return Number.isFinite(balance) ? { ok: true, balance, unit: String(info['currency'] ?? 'USD') } : { ok: false, detail: 'DeepSeek gave no balance' };
}

/** OpenRouter: `GET /key`, what is left of this key's own limit (null: the key has none). */
export function readOpenRouterKey(body: Record<string, unknown>): BalanceRead {
    const data = (body['data'] ?? {}) as Record<string, unknown>;
    const left = data['limit_remaining'];
    if (left === null || left === undefined) return { ok: true, balance: null, unit: 'USD key limit' };
    const balance = Number(left);
    return Number.isFinite(balance) ? { ok: true, balance, unit: 'USD key limit' } : { ok: false, detail: 'OpenRouter gave no key limit' };
}

/** Read one connection's balance, when its preset can. */
export async function readBalance(connection: AiConnection): Promise<BalanceRead> {
    const preset = findPreset(connection.preset);
    if (!preset?.balance) return { ok: false, detail: `${preset?.label ?? connection.preset} gives no balance to its key` };
    const key = await readKey(connection, Date.now(), { fresh: true });
    if (!key.ok) return { ok: false, detail: key.detail };
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, detail: `connection ${connection.id} has no address` };
    try {
        if (preset.balance === 'deepseek') {
            const { status, body } = await getJson(`${new URL(base).origin}/user/balance`, connection, key.key);
            return status === 200 ? readDeepSeekBalance(body) : { ok: false, detail: `DeepSeek answered ${status}` };
        }
        const { status, body } = await getJson(`${base}/key`, connection, key.key);
        return status === 200 ? readOpenRouterKey(body) : { ok: false, detail: `OpenRouter answered ${status}` };
    } catch (err) {
        return { ok: false, detail: `the balance could not be read: ${String((err as Error).message ?? err).slice(0, 160)}` };
    }
}

/**
 * Read a connection's balance, store it on the connection, and tell admins once when it is
 * below the low mark. Returns what was read.
 */
export async function refreshBalance(connection: AiConnection, now = new Date()): Promise<BalanceRead> {
    const read = await readBalance(connection);
    if (!read.ok) return read;
    const below = read.balance !== null && connection.lowBalance !== null && read.balance < connection.lowBalance;
    // Told already about this mark: not again until the balance rises above it, or the admin sets another.
    const told = connection.balanceLowAlerted && connection.balanceAlertMark === connection.lowBalance;
    const at = `connections.${connection.id}`;
    const ref = db.collection('Settings').doc(AI_SETTINGS_DOC);
    const fresh = (await ref.get()).data();
    // A connection deleted meanwhile must not come back as a balance.
    if (!(fresh?.['connections'] ?? {})[connection.id]) return read;
    await ref.update({
        [`${at}.balance`]: read.balance,
        [`${at}.balanceUnit`]: read.unit,
        [`${at}.balanceAt`]: now.toISOString(),
        [`${at}.balanceLowAlerted`]: below,
        [`${at}.balanceAlertMark`]: below ? connection.lowBalance : null,
    });
    if (below && !told) {
        await notifyAdmins('admin_ai_balance', {
            title: `${connection.label}: balance low`,
            body: `${connection.label} has ${read.balance} ${read.unit} left, below the ${connection.lowBalance} set in Settings, AI. Add credit with the provider before calls start to fail.`,
            link: '/admin/settings/ai',
        });
    }
    return read;
}
