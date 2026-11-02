/**
 * The month's totals (specs/ai-spec.md, AI-D14, AI-D15): `AiUsage/{yyyy-mm}` holds the live
 * calls, failures, tokens and cost of the site's month, by day, purpose and model, and
 * `AiUsage/{yyyy-mm}/keys/{purpose}__{key}` one key's. Test calls are only counted, as
 * `testCalls`: they cost nothing. When a call takes the month past 80% or all of the
 * budget, admins get a notification and an email, once each a month.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';
import { AI_USAGE, currentSiteDay, keyId } from './limits.js';
import type { AiCallRecord } from './records.js';
import { readAiSettings, type AiSettings } from './settings.js';

/** A model's key in the totals: Firestore field names cannot hold every character a model id has. */
export function modelField(connection: string, model: string): string {
    return `${connection}__${model}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150);
}

function counts(record: AiCallRecord): Record<string, unknown> {
    const out: Record<string, unknown> = {
        calls: FieldValue.increment(1),
        failed: FieldValue.increment(record.outcome === 'ok' ? 0 : 1),
        tokensIn: FieldValue.increment(record.tokensIn),
        tokensOut: FieldValue.increment(record.tokensOut),
        tokensThinking: FieldValue.increment(record.tokensThinking),
        costUsd: FieldValue.increment(record.costUsd),
    };
    // Cached tokens and the billed amount of a file kind, only when there are some (AM-D27).
    if (record.tokensCached) out['tokensCached'] = FieldValue.increment(record.tokensCached);
    if (record.tokensCacheWrite) out['tokensCacheWrite'] = FieldValue.increment(record.tokensCacheWrite);
    if (record.unit && record.unit !== 'tokens' && record.amount) out[record.unit] = FieldValue.increment(record.amount);
    return out;
}

/** A hit in Arc's own cache: counted apart, never as a call (AM-D16). Made when used, not when the module loads. */
const cacheHit = () => ({ cacheHits: FieldValue.increment(1) });

/**
 * Add a call to its month's totals. Never throws: the app's answer must not be lost over its
 * totals. `spentBefore` (from the budget check) skips the alert's transaction for a call that
 * cannot have taken the month past 80% of `budget`, so most calls write the month once.
 */
export async function addToTotals(record: AiCallRecord, at = new Date(), budget?: { spentBefore: number; monthlyUsd: number }): Promise<void> {
    try {
        const day = await currentSiteDay(at);
        const month = db.collection(AI_USAGE).doc(day.month);
        if (record.test) {
            await month.set({ month: day.month, testCalls: FieldValue.increment(1) }, { merge: true });
            return;
        }
        if (record.cached) {
            await month.set({ month: day.month, ...cacheHit(), byPurpose: { [record.purpose]: cacheHit() }, byKind: { [record.kind]: cacheHit() } }, { merge: true });
            return;
        }
        const update: Record<string, unknown> = {
            month: day.month,
            ...counts(record),
            byDay: { [day.day]: counts(record) },
            byPurpose: { [record.purpose]: counts(record) },
            byKind: { [record.kind ?? 'text']: counts(record) },
        };
        if (record.connection && record.model) {
            update['byModel'] = { [modelField(record.connection, record.model)]: { connection: record.connection, model: record.model, ...counts(record) } };
        }
        await month.set(update, { merge: true });
        if (record.limitKey) {
            await month.collection('keys').doc(`${record.purpose}__${keyId(record.limitKey)}`).set({
                purpose: record.purpose,
                limitKey: record.limitKey,
                units: FieldValue.increment(record.outcome === 'ok' ? record.units : 0),
                ...counts(record),
            }, { merge: true });
        }
        const mayCross = !budget || budget.spentBefore + record.costUsd >= budget.monthlyUsd * 0.8;
        if (record.costUsd > 0 && mayCross) await alertOnBudget(day.month);
    } catch (err) {
        console.error(`askAi: a ${record.purpose} call was not added to the totals`, err);
    }
}

/** Tell admins once a month when spending reaches 80% and 100% of the budget. */
export async function alertOnBudget(month: string, settings?: AiSettings): Promise<void> {
    const s = settings ?? (await readAiSettings());
    const budget = s.budget.monthlyUsd;
    if (budget <= 0) return;
    const ref = db.collection(AI_USAGE).doc(month);
    const due = await db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data() ?? {};
        const spent = Number(data['costUsd'] ?? 0);
        const alerted = (data['alerted'] ?? {}) as Record<string, boolean>;
        const level = spent >= budget ? '100' : spent >= budget * 0.8 ? '80' : null;
        if (!level || alerted[level]) return null;
        tx.set(ref, { alerted: { [level]: true, ...(level === '100' ? { '80': true } : {}) } }, { merge: true });
        return { level, spent };
    });
    if (!due) return;
    const spent = due.spent.toFixed(2);
    await notifyAdmins('admin_ai_budget', due.level === '100'
        ? { title: 'AI budget spent', body: `AI calls cost ${spent} USD this month, the whole budget of ${budget} USD. Live calls stop until next month or until the budget is raised in Settings, AI.`, link: '/admin/settings/ai' }
        : { title: 'AI budget at 80%', body: `AI calls cost ${spent} USD this month, 80% of the budget of ${budget} USD.`, link: '/admin/settings/ai' });
}

/**
 * Tell admins once a day per connection that its provider says the account has no credit
 * (specs/ai-media-spec.md, AM-D32). Never throws.
 */
export async function alertOutOfCredit(connectionId: string, label: string, detail: string, at = new Date()): Promise<void> {
    try {
        const day = await currentSiteDay(at);
        const ref = db.collection(AI_USAGE).doc(day.month);
        const today = `${day.month}-${day.day}`;
        const due = await db.runTransaction(async (tx) => {
            const alerts = ((await tx.get(ref)).data()?.['creditAlerts'] ?? {}) as Record<string, string>;
            if (alerts[connectionId] === today) return false;
            tx.set(ref, { month: day.month, creditAlerts: { [connectionId]: today } }, { merge: true });
            return true;
        });
        if (!due) return;
        await notifyAdmins('admin_ai_credit', {
            title: `${label}: no credit left`,
            body: `${label} says its account has no credit left, so calls to it fail and the next model in each list answers. Add credit with the provider. (${detail.slice(0, 160)})`,
            link: '/admin/settings/ai',
        });
    } catch (err) {
        console.error(`askAi: admins were not told that connection ${connectionId} has no credit`, err);
    }
}

/** One key's totals for a month (the site's month now when left out), for one purpose or all. */
export async function aiUsage(options: { limitKey: string; purpose?: string; month?: string }): Promise<{ calls: number; failed: number; units: number; tokensIn: number; tokensOut: number; costUsd: number }> {
    if (typeof options?.limitKey !== 'string' || !options.limitKey) throw new Error('aiUsage: pass the limitKey whose totals you want.');
    if (options.month !== undefined && !/^\d{4}-\d{2}$/.test(options.month)) throw new Error('aiUsage: month is yyyy-mm, such as 2026-10.');
    const month = options.month ?? (await currentSiteDay()).month;
    const keys = db.collection(AI_USAGE).doc(month).collection('keys');
    const docs = options.purpose
        ? [await keys.doc(`${options.purpose}__${keyId(options.limitKey)}`).get()].filter((d) => d.exists)
        : (await keys.where('limitKey', '==', options.limitKey).get()).docs;
    const total = { calls: 0, failed: 0, units: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    for (const d of docs) {
        const data = d.data() ?? {};
        for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += Number(data[k] ?? 0);
    }
    return total;
}

/**
 * Note on the connection, for the admin page, that it answered or why it did not. Written
 * only when it changes, or an hour after the last success, so busy calls do not rewrite
 * Settings, AI each time. Never throws.
 */
export async function noteConnection(settings: AiSettings, connectionId: string, error: string | null, now = new Date()): Promise<void> {
    const c = settings.connections[connectionId];
    if (!c) return;
    const iso = now.toISOString();
    if (!error && !c.lastError && c.lastOkAt && now.getTime() - Date.parse(c.lastOkAt) < 3_600_000) return;
    if (error && c.lastError === error.slice(0, 300)) return;
    try {
        // The settings may be 15 seconds old: a connection deleted since must not come back as a note.
        const fresh = (await db.collection('Settings').doc('ai').get()).data();
        if (!(fresh?.['connections'] ?? {})[connectionId]) return;
        const update: Record<string, unknown> = error
            ? { [`connections.${connectionId}.lastError`]: error.slice(0, 300), [`connections.${connectionId}.lastErrorAt`]: iso }
            : { [`connections.${connectionId}.lastOkAt`]: iso, [`connections.${connectionId}.lastError`]: null };
        await db.collection('Settings').doc('ai').update(update);
        if (error) c.lastError = error.slice(0, 300);
        else {
            c.lastOkAt = iso;
            c.lastError = null;
        }
    } catch (err) {
        console.error(`askAi: connection ${connectionId}'s state was not noted`, err);
    }
}
