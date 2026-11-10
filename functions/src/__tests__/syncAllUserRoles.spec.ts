/**
 * syncAllUserRoles: an active admin (by record) re-applies every user's claims, a page
 * of records at a time, and a blocked record gets none.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
    const users: Array<{ id: string; data: Record<string, unknown> }> = [];
    const pageReads: number[] = [];
    type Filter = [string, unknown];
    const query = (filters: Filter[], max = Infinity, after?: string): any => ({
        where: (field: string, _op: string, value: unknown) => query([...filters, [field, value]], max, after),
        orderBy: () => query(filters, max, after),
        limit: (n: number) => query(filters, n, after),
        startAfter: (doc: { id: string }) => query(filters, max, doc.id),
        get: async () => {
            const rows = [...users]
                .sort((a, b) => a.id.localeCompare(b.id))
                .filter((u) => filters.every(([f, v]) => u.data[f] === v))
                .filter((u) => after === undefined || u.id > after)
                .slice(0, max);
            if (max !== Infinity) pageReads.push(rows.length);
            const docs = rows.map((u) => ({ id: u.id, data: () => u.data }));
            return { empty: !docs.length, size: docs.length, docs };
        },
    });
    return {
        users, pageReads,
        db: { collection: () => query([]) },
        setRecordClaims: vi.fn(async () => undefined),
        clearArcClaims: vi.fn(async () => undefined),
    };
});

vi.mock('../init', () => ({ db: m.db, owner: {} }));
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' }, FieldValue: {} }));
vi.mock('../users/claims', () => ({
    setRecordClaims: m.setRecordClaims, clearArcClaims: m.clearArcClaims, mergeUserClaims: vi.fn(),
    isArcAdmin: vi.fn(), ROLE_CLAIM: 'arccms_role', USER_RECORD_CLAIM: 'arccms_uid',
}));
vi.mock('../arc-config', () => ({ arcDocument: vi.fn() }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWrittenWithAuthContext: vi.fn(() => () => undefined) }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (handler: unknown) => handler,
    HttpsError: class extends Error {
        constructor(public code: string, message: string) {
            super(message);
        }
    },
}));

import { SYNC_PAGE_SIZE, syncAllUserRoles } from '../users/syncUserRole.js';

const call = (uid?: string) =>
    (syncAllUserRoles as unknown as (r: unknown) => Promise<any>)({ auth: uid ? { uid, token: {} } : undefined, data: {} });

beforeEach(() => {
    m.users.length = 0;
    m.pageReads.length = 0;
    vi.clearAllMocks();
});

describe('syncAllUserRoles', () => {
    it('is for an active admin only, by record', async () => {
        await expect(call()).rejects.toMatchObject({ code: 'unauthenticated' });
        m.users.push({ id: 'a', data: { uid: 'u-a', role: 'user' } });
        await expect(call('u-a')).rejects.toMatchObject({ code: 'permission-denied' });
        // A blocked admin is not an admin.
        m.users.push({ id: 'b', data: { uid: 'u-b', role: 'admin', isActive: false } });
        await expect(call('u-b')).rejects.toMatchObject({ code: 'permission-denied' });
        expect(m.setRecordClaims).not.toHaveBeenCalled();
    });

    it('reads the records a page at a time and syncs every one', async () => {
        m.users.push({ id: 'admin', data: { uid: 'u-admin', role: 'admin', isActive: true } });
        for (let i = 0; i < SYNC_PAGE_SIZE + 5; i++) m.users.push({ id: `r${String(i).padStart(4, '0')}`, data: { uid: `u${i}`, role: 'user' } });
        m.users.push({ id: 'z-no-uid', data: { role: 'user' } });

        const result = await call('u-admin');
        expect(result).toEqual({ synced: SYNC_PAGE_SIZE + 6, skipped: 1, total: SYNC_PAGE_SIZE + 7 });
        // Two pages: a full one, then the rest.
        expect(m.pageReads).toEqual([SYNC_PAGE_SIZE, 7]);
        expect(m.setRecordClaims).toHaveBeenCalledWith('u0', 'user', 'r0000');
    });

    it('takes the claims off a blocked or detached record instead of setting them', async () => {
        m.users.push({ id: 'admin', data: { uid: 'u-admin', role: 'admin' } });
        m.users.push({ id: 'blocked', data: { uid: 'u-blocked', role: 'admin', isActive: false } });
        m.users.push({ id: 'detached', data: { uid: 'u-detached', role: 'user', status: 'Detached' } });
        await call('u-admin');
        expect(m.clearArcClaims).toHaveBeenCalledWith('u-blocked');
        expect(m.clearArcClaims).toHaveBeenCalledWith('u-detached');
        expect(m.setRecordClaims).toHaveBeenCalledTimes(1);
        expect(m.setRecordClaims).toHaveBeenCalledWith('u-admin', 'admin', 'admin');
    });
});
