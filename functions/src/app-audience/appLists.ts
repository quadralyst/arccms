/**
 * App users (live) lists (docs/coexistence-spec.md 5b, CO6.5b).
 *
 * A live list stores conditions on the host app's fields, never members. Every
 * use (a count, the list page, a broadcast) reads the host collection and keeps
 * the people who match all conditions. Only the conditions can be edited: who is
 * in the list follows the app's data.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, firestoreFor } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import { appUsersLocation, type AppAudienceSettings } from './config.js';
import { readAppAudienceSettings } from './adminCallables.js';
import { displayValue, maskResolvedAppUser, resolveAppUser, valueAt } from './fields.js';
import { appMergeFields } from './mergeFields.js';
import { appUserStateId, readAppUserConsents, type AppUserConsent } from './state.js';
import { MAX_APP_USERS } from './listAppUsers.js';

export const APP_LIST_TYPE = 'app';

export const APP_LIST_OPS = ['is', 'is_not', 'any_of', 'contains', 'gt', 'lt', 'empty', 'not_empty'] as const;
export type AppListOp = (typeof APP_LIST_OPS)[number];

export interface AppListCondition {
    field: string;
    op: AppListOp;
    /** Text for is / is_not / contains / gt / lt; a list for any_of; unused for empty / not_empty. */
    value?: string | string[];
}

/** Drops malformed conditions, so a half-edited list never matches everyone by accident of a typo. */
export function normalizeAppListConditions(raw: unknown): AppListCondition[] {
    if (!Array.isArray(raw)) return [];
    const out: AppListCondition[] = [];
    for (const c of raw) {
        const field = typeof c?.field === 'string' ? c.field.trim() : '';
        const op = c?.op as AppListOp;
        if (!field || !APP_LIST_OPS.includes(op)) continue;
        if (op === 'any_of') {
            const values = Array.isArray(c.value) ? c.value.map((v: unknown) => String(v).trim()) : [];
            out.push({ field, op, value: values });
        } else if (op === 'empty' || op === 'not_empty') {
            out.push({ field, op });
        } else {
            out.push({ field, op, value: c.value == null ? '' : String(c.value).trim() });
        }
    }
    return out;
}

/** A date written as a date: `2026-10-01`, or with a time (`2026-10-01T09:30:00Z`). */
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * A number, or a date as milliseconds, for greater than / less than, with its
 * kind: only a number compares with a number and a date with a date. A date
 * has to look like one: Date.parse alone reads text such as "Plan 2" as a date
 * (review C7), so `plan gt 1` used to match it.
 */
export function comparable(text: string): { kind: 'number' | 'date'; value: number } | null {
    if (text === '') return null;
    const n = Number(text);
    if (Number.isFinite(n)) return { kind: 'number', value: n };
    if (!DATE_TEXT.test(text)) return null;
    const t = Date.parse(text);
    return Number.isNaN(t) ? null : { kind: 'date', value: t };
}

/**
 * Whether one host document matches every condition. Values compare as text,
 * case-insensitively, the way they show in the admin (booleans are 'true' and
 * 'false', dates are ISO); greater and less than compare numbers or dates.
 */
export function matchesAppConditions(data: Record<string, unknown>, conditions: AppListCondition[]): boolean {
    return conditions.every((c) => {
        const text = displayValue(valueAt(data, c.field)).trim();
        const lower = text.toLowerCase();
        const want = typeof c.value === 'string' ? c.value.toLowerCase() : '';
        switch (c.op) {
            case 'is': return lower === want;
            case 'is_not': return lower !== want;
            case 'any_of': return (Array.isArray(c.value) ? c.value : []).some((v) => v.toLowerCase() === lower);
            case 'contains': return want !== '' && lower.includes(want);
            case 'empty': return text === '';
            case 'not_empty': return text !== '';
            case 'gt':
            case 'lt': {
                const a = comparable(text);
                const b = comparable(typeof c.value === 'string' ? c.value.trim() : '');
                if (a === null || b === null || a.kind !== b.kind) return false;
                return c.op === 'gt' ? a.value > b.value : a.value < b.value;
            }
        }
    });
}

export interface AppListMember {
    docId: string;
    key: string;
    email: string;
    name: string;
    appUserId: string;
    consent: AppUserConsent;
    /** For ##APP.<path>## in the email. */
    fields: Record<string, string>;
}

/**
 * One member per email address, for sending (review C5). A host app can hold
 * two documents with the same address (a duplicate account, say); a broadcast
 * sent to both would email that address twice. The first by document id is
 * kept, so paging and resuming see the same member every time. If any of them
 * unsubscribed, the address counts as unsubscribed: an opt-out is never
 * outvoted by a second account. Members with no address are dropped.
 */
export function oneMemberPerAddress(members: AppListMember[]): AppListMember[] {
    const byEmail = new Map<string, AppListMember>();
    for (const m of members) {
        if (!m.email) continue;
        const email = m.email.toLowerCase();
        const kept = byEmail.get(email);
        if (!kept) byEmail.set(email, { ...m });
        else if (m.consent === 'unsubscribed') kept.consent = 'unsubscribed';
    }
    return [...byEmail.values()];
}

export interface AppListResolution {
    /** Everyone matching, with a unique key, sorted by document id. */
    members: AppListMember[];
    scanned: number;
    truncated: boolean;
}

/** Reads the host collection and keeps the people who match. */
export async function resolveAppList(
    conditions: AppListCondition[],
    settings?: AppAudienceSettings,
): Promise<AppListResolution> {
    const location = appUsersLocation();
    if (!location.configured) return { members: [], scanned: 0, truncated: false };
    const readSettings = settings ?? await readAppAudienceSettings();
    const snap = await firestoreFor(location.database).collection(location.collection).limit(MAX_APP_USERS + 1).get();
    const truncated = snap.size > MAX_APP_USERS;
    const docs = snap.docs.slice(0, MAX_APP_USERS);

    const matched = [];
    for (const doc of docs) {
        const data = doc.data();
        if (!matchesAppConditions(data, conditions)) continue;
        const person = resolveAppUser(doc.id, data, readSettings);
        if (!person.key) continue;
        matched.push({ person, data });
    }
    const ids = matched.map((m) => appUserStateId(m.person.key));
    const consents = await readAppUserConsents(db, ids);
    const members = matched
        .map(({ person, data }, i) => ({
            docId: person.docId,
            key: person.key,
            email: person.email,
            name: person.name,
            appUserId: ids[i],
            consent: consents.get(ids[i]) ?? 'subscribed',
            fields: appMergeFields(data),
        }))
        .sort((a, b) => (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0));
    return { members, scanned: docs.length, truncated };
}

/** A list's conditions from its `Lists` document, or null when it is not a live list. */
export function appListConditionsOf(list: Record<string, unknown> | undefined): AppListCondition[] | null {
    if (!list || list['type'] !== APP_LIST_TYPE) return null;
    return normalizeAppListConditions(list['conditions']);
}

/**
 * Who a live list matches right now. Pass `conditions` (the list editor, before
 * saving) or `listId` (a saved list). Returns counts and the first 200 people,
 * with channel values from credential-like fields hidden.
 */
export const previewAppList = onCall(async (request) => {
    await requireAdmin(request);
    if (!appUsersLocation().configured) {
        throw new HttpsError('failed-precondition', 'No host collection is configured. See Settings, App audience.');
    }
    let conditions: AppListCondition[];
    const listId = typeof request.data?.listId === 'string' ? request.data.listId.trim() : '';
    if (listId) {
        const snap = await db.collection('Lists').doc(listId).get();
        const saved = appListConditionsOf(snap.exists ? snap.data() : undefined);
        if (!saved) throw new HttpsError('not-found', 'That list is not an App users (live) list.');
        conditions = saved;
    } else {
        conditions = normalizeAppListConditions(request.data?.conditions);
    }

    const settings = await readAppAudienceSettings();
    const { members, scanned, truncated } = await resolveAppList(conditions, settings);
    const addresses = oneMemberPerAddress(members);
    const withEmail = members.filter((m) => m.email).length;
    const rows = members.slice(0, 200).map((m) => {
        const shown = maskResolvedAppUser({ docId: m.docId, key: m.key, email: m.email, phone: '', name: m.name }, settings);
        return { docId: m.docId, key: shown.key, email: shown.email, name: shown.name, consent: m.consent };
    });
    return {
        matched: members.length,
        withEmail,
        /** People whose address another matching person also has: emailed once per address. */
        sharedEmail: withEmail - addresses.length,
        /** Addresses a send would email, one per address. */
        subscribed: addresses.filter((m) => m.consent === 'subscribed').length,
        scanned,
        truncated,
        rows,
    };
});
