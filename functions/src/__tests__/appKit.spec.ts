/**
 * The app kit (docs/app/app-kit.html, specs/app-accounts-spec.md): accounts without
 * email or phone, an app's own claims, sessions, and the export list kept in step with
 * the docs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fb = vi.hoisted(() => {
    const state = { claims: {} as Record<string, Record<string, unknown>>, records: [] as Array<{ id: string; data: Record<string, unknown> }>, nextUid: 1 };
    const owner = {
        createUser: vi.fn(async (input: { uid?: string; displayName: string }) => ({ uid: input.uid ?? `uid-${state.nextUid++}` })),
        deleteUser: vi.fn(async () => undefined),
        getUser: vi.fn(async (uid: string) => ({ uid, customClaims: state.claims[uid] })),
        setCustomUserClaims: vi.fn(async (uid: string, claims: Record<string, unknown>) => { state.claims[uid] = claims; }),
        revokeRefreshTokens: vi.fn(async () => undefined),
        createCustomToken: vi.fn(async (uid: string) => `token-for-${uid}`),
    };
    const recordRef = (id: string) => ({
        id,
        set: vi.fn(async (data: Record<string, unknown>) => { state.records.push({ id, data }); }),
        delete: vi.fn(async () => { state.records = state.records.filter((r) => r.id !== id); }),
    });
    const db = {
        collection: vi.fn(() => ({
            doc: vi.fn(() => recordRef(`rec-${state.records.length + 1}`)),
            where: vi.fn((_field: string, _op: string, uid: string) => ({
                limit: () => ({
                    get: async () => {
                        const found = state.records.filter((r) => r.data['uid'] === uid);
                        return { empty: !found.length, docs: found.map((r) => ({ exists: true, ref: recordRef(r.id), data: () => r.data })) };
                    },
                }),
            })),
        })),
    };
    return { state, owner, db };
});

vi.mock('../init.js', () => ({ owner: fb.owner, db: fb.db }));
// The claims lease has its own spec (claimLock.spec.ts); here it simply runs the work.
vi.mock('../users/claimLock.js', () => ({ withClaimLock: (_uid: string, work: () => Promise<unknown>) => work() }));

import * as kit from '../app-kit/index.js';
import { createAppAccount, deleteAppAccount, issueSignInToken, mergeAppClaims, restoreAppSignIn, revokeSessions, signedInByApp } from '../app-kit/index.js';
import { mergeClaims, mergeUserClaims } from '../users/claims.js';

beforeEach(() => {
    vi.clearAllMocks();
    fb.state.claims = {};
    fb.state.records = [];
    fb.state.nextUid = 1;
});

describe('createAppAccount', () => {
    it('makes a sign-in account and a users record with no email and no phone, role user, by app', async () => {
        const account = await createAppAccount({ displayName: '  Anna  ' });
        expect(account).toEqual({ uid: 'uid-1', userDocId: 'rec-1' });
        expect(fb.owner.createUser).toHaveBeenCalledWith({ displayName: 'Anna' });
        expect(fb.state.records[0].data).toMatchObject({
            id: 'rec-1', uid: 'uid-1', name: 'Anna', email: '', phone: '', emailVerified: false, phoneVerified: false,
            role: 'user', status: 'Active', isActive: true, by: 'app',
        });
    });

    it('sets ArcCMS\'s claims and the app\'s in one write, before the record exists', async () => {
        let recordsWhenClaimsSet = -1;
        fb.owner.setCustomUserClaims.mockImplementationOnce(async (uid: string, claims: Record<string, unknown>) => {
            recordsWhenClaimsSet = fb.state.records.length;
            fb.state.claims[uid] = claims;
        });
        await createAppAccount({ displayName: 'Anna', claims: { site: 's-1', staffRole: 'reception' } });
        expect(fb.owner.setCustomUserClaims).toHaveBeenCalledTimes(1);
        expect(fb.state.claims['uid-1']).toEqual({ site: 's-1', staffRole: 'reception', arccms_role: 'user', arccms_uid: 'rec-1' });
        // The first sign-in's token already carries them: they are set before the record exists.
        expect(recordsWhenClaimsSet).toBe(0);
    });

    it('locks the account unless the app asks for selfService (specs/app-account-lock-spec.md)', async () => {
        await createAppAccount({ displayName: 'Anna' });
        await createAppAccount({ displayName: 'Ben', selfService: true });
        expect(fb.state.records[0].data['selfService']).toBe(false);
        expect(fb.state.records[1].data['selfService']).toBe(true);
    });

    it('uses the app\'s own uid when given', async () => {
        await createAppAccount({ displayName: 'Anna', uid: 'staff-42' });
        expect(fb.owner.createUser).toHaveBeenCalledWith({ displayName: 'Anna', uid: 'staff-42' });
    });

    it('refuses a missing name and ArcCMS or Firebase claim names, creating nothing', async () => {
        await expect(createAppAccount({ displayName: '  ' })).rejects.toThrow('A display name is required.');
        await expect(createAppAccount({ displayName: 'Anna', claims: { arccms_role: 'admin' } })).rejects.toThrow(/arccms_/);
        await expect(createAppAccount({ displayName: 'Anna', claims: { sub: 'x' } })).rejects.toThrow('reserved by Firebase');
        expect(fb.owner.createUser).not.toHaveBeenCalled();
    });

    it('never leaves a sign-in account behind when the record cannot be written', async () => {
        fb.db.collection.mockImplementationOnce(() => ({ doc: () => ({ id: 'rec-x', set: async () => { throw new Error('offline'); } }) }) as never);
        await expect(createAppAccount({ displayName: 'Anna' })).rejects.toThrow('offline');
        expect(fb.owner.deleteUser).toHaveBeenCalledWith('uid-1');
    });

    it('signs the person in with a custom token', async () => {
        const { uid } = await createAppAccount({ displayName: 'Anna' });
        await expect(issueSignInToken(uid)).resolves.toBe('token-for-uid-1');
    });
});

describe('deleteAppAccount', () => {
    it('deletes the record, which starts ArcCMS\'s account deletion', async () => {
        const { uid } = await createAppAccount({ displayName: 'Anna' });
        await deleteAppAccount(uid);
        expect(fb.state.records).toEqual([]);
    });

    it('says so when no account has the uid', async () => {
        await expect(deleteAppAccount('nobody')).rejects.toThrow('No account has this uid.');
    });
});

describe('restoreAppSignIn', () => {
    const gone = Object.assign(new Error('gone'), { code: 'auth/user-not-found' });

    it('gives a deleted sign-in back with the same uid, the record\'s name, ArcCMS\'s claims and the app\'s', async () => {
        await createAppAccount({ displayName: 'Anna', uid: 'staff-1', claims: { site: 's-1' } });
        // The browser deleted the sign-in: Firebase took its claims with it.
        delete fb.state.claims['staff-1'];
        fb.owner.getUser.mockRejectedValueOnce(gone);
        fb.owner.createUser.mockClear();

        const account = await restoreAppSignIn('staff-1', { site: 's-1' });
        expect(account).toEqual({ uid: 'staff-1', userDocId: 'rec-1' });
        expect(fb.owner.createUser).toHaveBeenCalledWith({ uid: 'staff-1', displayName: 'Anna' });
        expect(fb.state.claims['staff-1']).toEqual({ site: 's-1', arccms_role: 'user', arccms_uid: 'rec-1' });
        expect(fb.state.records).toHaveLength(1);
    });

    it('only sets the claims again when the sign-in is there, so it is safe to repeat', async () => {
        await createAppAccount({ displayName: 'Anna', uid: 'staff-2' });
        fb.owner.createUser.mockClear();
        await restoreAppSignIn('staff-2', { site: 's-2' });
        expect(fb.owner.createUser).not.toHaveBeenCalled();
        expect(fb.state.claims['staff-2']).toMatchObject({ site: 's-2', arccms_uid: 'rec-1' });
    });

    it('gives a blocked record no ArcCMS claims back', async () => {
        await createAppAccount({ displayName: 'Anna', uid: 'staff-3' });
        fb.state.records[0].data['isActive'] = false;
        delete fb.state.claims['staff-3'];
        fb.owner.getUser.mockRejectedValueOnce(gone);
        await restoreAppSignIn('staff-3', { site: 's-3' });
        expect(fb.state.claims['staff-3']).toEqual({ site: 's-3' });
    });

    it('refuses an unknown uid, an account the app did not make, and ArcCMS claim names', async () => {
        await expect(restoreAppSignIn('nobody')).rejects.toMatchObject({ code: 'not-found' });
        fb.state.records.push({ id: 'rec-9', data: { id: 'rec-9', uid: 'member-9', by: 'email', name: 'Ben' } });
        await expect(restoreAppSignIn('member-9')).rejects.toMatchObject({ code: 'failed-precondition' });
        await createAppAccount({ displayName: 'Anna', uid: 'staff-4' });
        fb.owner.createUser.mockClear();
        await expect(restoreAppSignIn('staff-4', { arccms_role: 'admin' })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(fb.owner.createUser).not.toHaveBeenCalled();
    });
});

describe('signedInByApp', () => {
    const request = (provider?: string) => ({ auth: { uid: 'u', token: { firebase: { sign_in_provider: provider } } } }) as never;

    it('is true only for a session from the app\'s sign-in token, like the rules helper', () => {
        expect(signedInByApp(request('custom'))).toBe(true);
        for (const other of ['google.com', 'password', 'phone', undefined]) expect(signedInByApp(request(other))).toBe(false);
        expect(signedInByApp({ auth: undefined } as never)).toBe(false);
    });
});

describe('mergeAppClaims', () => {
    it('merges, never replaces, and removes an app claim with null', async () => {
        fb.state.claims['u'] = { arccms_role: 'user', arccms_uid: 'rec-1', site: 's-1' };
        await mergeAppClaims('u', { staffRole: 'manager', perms: ['check-in', 'reports'] });
        expect(fb.state.claims['u']).toEqual({ arccms_role: 'user', arccms_uid: 'rec-1', site: 's-1', staffRole: 'manager', perms: ['check-in', 'reports'] });
        await mergeAppClaims('u', { site: null });
        expect(fb.state.claims['u']).not.toHaveProperty('site');
    });

    it('refuses arccms_ names, Firebase\'s names and an empty patch', async () => {
        await expect(mergeAppClaims('u', { arccms_role: 'admin' })).rejects.toThrow('may not start with arccms_');
        await expect(mergeAppClaims('u', { firebase: {} })).rejects.toThrow('reserved by Firebase');
        await expect(mergeAppClaims('u', {})).rejects.toThrow('at least one claim');
        expect(fb.owner.setCustomUserClaims).not.toHaveBeenCalled();
    });

    it('refuses before writing when all the claims would pass 1000 bytes', async () => {
        fb.state.claims['u'] = { arccms_role: 'user' };
        await expect(mergeAppClaims('u', { notes: 'x'.repeat(990) })).rejects.toThrow(/1000/);
        expect(fb.owner.setCustomUserClaims).not.toHaveBeenCalled();
    });

    it('keeps the app\'s claims through ArcCMS\'s own claim writes, and the other way round', async () => {
        fb.state.claims['u'] = { site: 's-1' };
        await mergeUserClaims('u', { arccms_role: 'editor', arccms_uid: 'rec-1' });
        expect(fb.state.claims['u']).toEqual({ site: 's-1', arccms_role: 'editor', arccms_uid: 'rec-1' });
        await mergeAppClaims('u', { staffRole: 'reception' });
        expect(fb.state.claims['u']).toEqual({ site: 's-1', arccms_role: 'editor', arccms_uid: 'rec-1', staffRole: 'reception' });
    });
});

describe('mergeClaims: write, read back, retry (C-D6)', () => {
    it('redoes the merge when another write replaced the claims in between', async () => {
        fb.state.claims['u'] = { a: '1' };
        let raced = false;
        fb.owner.setCustomUserClaims.mockImplementation(async (uid: string, claims: Record<string, unknown>) => {
            fb.state.claims[uid] = claims;
            // Another writer, working from the old claims, lands right after the first write.
            if (!raced) { raced = true; fb.state.claims[uid] = { a: '1', other: 'x' }; }
        });
        await mergeClaims('u', { mine: 'y' });
        expect(fb.state.claims['u']).toEqual({ a: '1', other: 'x', mine: 'y' });
        expect(fb.owner.setCustomUserClaims).toHaveBeenCalledTimes(2);
    });

    it('writes nothing when the claims already say so', async () => {
        fb.state.claims['u'] = { a: '1' };
        await mergeClaims('u', { a: '1' });
        expect(fb.owner.setCustomUserClaims).not.toHaveBeenCalled();
    });

    it('gives up with an error when another write keeps replacing them', async () => {
        fb.owner.setCustomUserClaims.mockImplementation(async (uid: string) => { fb.state.claims[uid] = { other: 'x' }; });
        await expect(mergeClaims('u', { mine: 'y' })).rejects.toThrow('another write kept replacing them');
        expect(fb.owner.setCustomUserClaims).toHaveBeenCalledTimes(3);
    });
});

describe('revokeSessions', () => {
    it('revokes the refresh tokens', async () => {
        await revokeSessions('u');
        expect(fb.owner.revokeRefreshTokens).toHaveBeenCalledWith('u');
    });
});

describe('the app kit\'s exports', () => {
    const DOCUMENTED = [
        'APP_ACCOUNT', 'createAppAccount', 'deleteAppAccount', 'isArcAdmin', 'issueSignInToken', 'mergeAppClaims', 'restoreAppSignIn',
        'revokeSessions', 'signedInByApp',
        'APP_PINS', 'callerKey', 'consumeRateLimit', 'createPhonePinCheck', 'createPinStore', 'hashedKey', 'isValidPin', 'isWeakPin',
    ];

    it('are exactly the documented ones', () => {
        expect(Object.keys(kit).sort()).toEqual([...DOCUMENTED].sort());
    });

    it('are each on docs/app/app-kit.html, and the page names nothing else as an export', () => {
        const page = readFileSync(resolve(__dirname, '../../../docs/app/app-kit.html'), 'utf8');
        const table = page.slice(page.indexOf('id="exports"'), page.indexOf('</table>', page.indexOf('id="exports"')));
        const named = [...table.matchAll(/<tr><td><code>([A-Za-z_]+)(?:\(\))?<\/code><\/td>/g)].map((m) => m[1]);
        expect(named.sort()).toEqual([...DOCUMENTED].sort());
    });
});
