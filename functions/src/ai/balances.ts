/**
 * A connection's balance, read with its own key (specs/ai-media-spec.md, AM-D32): DeepSeek's
 * account balance, what is left of an OpenRouter key's own limit, and the characters left of
 * an ElevenLabs plan this period. Read once a day by
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

/** ElevenLabs: `GET /v1/user/subscription`, the characters left of the plan's this period. */
export function readElevenLabsSubscription(body: Record<string, unknown>): BalanceRead {
    const used = Number(body['character_count']);
    const limit = Number(body['character_limit']);
    if (!Number.isFinite(used) || !Number.isFinite(limit)) return { ok: false, detail: 'ElevenLabs gave no character count' };
    return { ok: true, balance: Math.max(0, limit - used), unit: 'characters' };
}

/**
 * Kling: `GET /account/costs`, the units left of every resource pack still in use (up to 12
 * hours late, by Kling's docs). Kling shows no cash balance to the key.
 */
export function readKlingPacks(body: Record<string, unknown>): BalanceRead {
    const data = (body['data'] ?? {}) as Record<string, unknown>;
    const packs = Array.isArray(data['resource_pack_subscribe_infos']) ? (data['resource_pack_subscribe_infos'] as Array<Record<string, unknown>>) : null;
    if (!packs) return { ok: false, detail: 'Kling gave no resource packs' };
    const left = packs.filter((p) => p['status'] === 'online').reduce((n, p) => n + (Number(p['remaining_quantity']) || 0), 0);
    return { ok: true, balance: left, unit: 'units' };
}

/** HeyGen: `GET /v3/users/me`, what is left of the API wallet. */
export function readHeyGenWallet(body: Record<string, unknown>): BalanceRead {
    const data = (body['data'] ?? {}) as Record<string, unknown>;
    const wallet = (data['wallet'] ?? null) as Record<string, unknown> | null;
    const left = Number(wallet?.['remaining_balance']);
    if (!wallet || !Number.isFinite(left)) return { ok: false, detail: 'HeyGen gave no wallet balance' };
    return { ok: true, balance: left, unit: String(wallet['currency'] ?? 'usd').toLowerCase() === 'credits' ? 'credits' : 'USD' };
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
        if (preset.balance === 'elevenlabs') {
            const { status, body } = await getJson(`${base}/user/subscription`, connection, key.key);
            return status === 200 ? readElevenLabsSubscription(body) : { ok: false, detail: `ElevenLabs answered ${status}` };
        }
        if (preset.balance === 'kling') {
            const end = Date.now();
            const { status, body } = await getJson(`${base}/account/costs?start_time=${end - 365 * 86_400_000}&end_time=${end}`, connection, key.key);
            return status === 200 ? readKlingPacks(body) : { ok: false, detail: `Kling answered ${status}` };
        }
        if (preset.balance === 'heygen') {
            const { status, body } = await getJson(`${base}/users/me`, connection, key.key);
            return status === 200 ? readHeyGenWallet(body) : { ok: false, detail: `HeyGen answered ${status}` };
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
