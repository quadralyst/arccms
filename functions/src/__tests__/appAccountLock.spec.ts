/**
 * App accounts are locked (specs/app-account-lock-spec.md, docs/app/app-accounts.html):
 * every callable a person uses to change their own account refuses an account made by
 * createAppAccount, unless the app made it with `selfService: true`. Ordinary accounts
 * behave as before. A locked account that signed in some other way loses that way in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const owner = vi.hoisted(() => ({
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    updateUser: vi.fn(),
    revokeRefreshTokens: vi.fn(),
    setCustomUserClaims: vi.fn(),
    createCustomToken: vi.fn(async (uid: string) => `token-${uid}`),
}));
const mocks = vi.hoisted(() => ({ queueEmail: vi.fn() }));

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }), serverTimestamp: () => 'now' } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWrittenWithAuthContext: vi.fn(() => () => undefined) }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((handler: unknown) => handler),
    HttpsError: class extends Error {
        constructor(public code: string, message: string, public details?: unknown) {
            super(message);
        }
    },
}));
vi.mock('../email-core/queueEmail', () => ({ queueEmail: mocks.queueEmail }));
vi.mock('../email-core/defaultTemplates', () => ({ ensureDefaultTemplates: vi.fn() }));
vi.mock('../email-core/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('../email-core/adminAlerts', () => ({ notifyAdmins: vi.fn() }));
vi.mock('../email-core/eraseContact', () => ({ eraseContact: vi.fn() }));
vi.mock('../email-core/contacts', () => ({
    SYSTEM_LISTS: { ALL_USERS: 'all-users' },
    ensureSystemLists: vi.fn(),
    upsertContact: vi.fn(),
    unlinkUserContact: vi.fn(),
}));

import { db } from '../init.js';
import * as phone from '../auth/phoneAuth.js';
import * as link from '../auth/linkIdentifiers.js';
import { verifySignupOtp } from '../auth/signupOtp.js';
import { ensureGoogleAccount } from '../auth/googleAccount.js';
import { createAccountRecord } from '../auth/emailAccount.js';
import { deleteMyAccount, refreshMyClaims } from '../users/accountCallables.js';
import { claimFirstAdmin } from '../users/syncUserRole.js';
import { isLockedAppAccount } from '../users/lockedAppAccount.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
type Handler = (request: unknown) => Promise<any>;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const call = (fn: unknown, data: Record<string, unknown>, uid: string, provider = 'custom') =>
    (fn as Handler)({
        data,
        auth: { uid, token: { auth_time: nowSeconds(), email: 'a@example.com', email_verified: true, firebase: { sign_in_provider: provider } } },
        rawRequest: { ip: '10.0.0.1', headers: {} },
    });

/** Whether the call was refused because the account is a locked app account. */
async function refusedAsAppManaged(promise: Promise<unknown>): Promise<boolean> {
    try {
        await promise;
        return false;
    } catch (err) {
        return (err as { details?: { reason?: string } }).details?.reason === 'app-managed';
    }
}

/** Every callable a person uses to change their own account, with a request that reaches its check. */
const SELF_SERVICE_CALLS: Array<[string, unknown, Record<string, unknown>]> = [
    ['deleteMyAccount', deleteMyAccount, {}],
    ['checkIdentifierForLink (email)', link.checkIdentifierForLink, { identifier: 'new@example.com' }],
    ['checkIdentifierForLink (phone)', link.checkIdentifierForLink, { identifier: '+919876543210' }],
    ['requestEmailLinkOtp', link.requestEmailLinkOtp, { email: 'new@example.com' }],
    ['linkEmail', link.linkEmail, { email: 'new@example.com', password: 'long enough password' }],
    ['linkPhone', link.linkPhone, { phone: '+919876543210', pin: '402719' }],
    ['requestPhoneOtp (link)', phone.requestPhoneOtp, { phone: '+919876543210', purpose: 'link' }],
    ['verifyPhoneOtp (link)', phone.verifyPhoneOtp, { phone: '+919876543210', code: '123456', purpose: 'link' }],
    ['setPin', phone.setPin, { pin: '402719' }],
    ['verifySignupOtp (link)', verifySignupOtp, { email: 'new@example.com', code: '123456', purpose: 'link' }],
    ['claimFirstAdmin', claimFirstAdmin, {}],
];

/** Providers per uid, for owner.getUser; claims kept as Firebase keeps them. */
let providers: Record<string, string[]>;
let claims: Record<string, Record<string, unknown>>;

beforeEach(() => {
    mem.store.clear();
    vi.clearAllMocks();
    providers = {};
    claims = {};
    owner.setCustomUserClaims.mockImplementation(async (uid: string, value: Record<string, unknown>) => { claims[uid] = value; });
    owner.getUser.mockImplementation(async (uid: string) => ({
        uid,
        email: providers[uid]?.includes('google.com') ? 'someone@gmail.com' : undefined,
        providerData: (providers[uid] ?? []).map((providerId) => ({ providerId })),
        customClaims: claims[uid],
        metadata: { creationTime: new Date().toUTCString() },
    }));
    owner.getUserByEmail.mockRejectedValue(Object.assign(new Error('not found'), { code: 'auth/user-not-found' }));
    mocks.queueEmail.mockResolvedValue({ id: 'log', status: 'pending' });
    mem.seed('Settings', 'users', { isSignupEnabled: true, phoneSignIn: true, googleSignIn: true });
    mem.seed('users', 'locked-doc', { uid: 'uid-locked', name: 'Anna', email: '', phone: '', role: 'user', isActive: true, status: 'Active', by: 'app' });
    mem.seed('users', 'open-doc', { uid: 'uid-open', name: 'Ben', email: '', phone: '', role: 'user', isActive: true, status: 'Active', by: 'app', selfService: true });
    mem.seed('users', 'member-doc', { uid: 'uid-member', name: 'Asha', email: 'a@example.com', role: 'user', isActive: true, status: 'Active', by: 'email' });
});

describe('the lock', () => {
    it('is on for app accounts unless selfService is true, and never on for other accounts', () => {
        expect(isLockedAppAccount({ by: 'app' })).toBe(true);
        expect(isLockedAppAccount({ by: 'app', selfService: false })).toBe(true);
        expect(isLockedAppAccount({ by: 'app', selfService: 'yes' })).toBe(true);
        expect(isLockedAppAccount({ by: 'app', selfService: true })).toBe(false);
        expect(isLockedAppAccount({ by: 'email' })).toBe(false);
        expect(isLockedAppAccount({ by: 'phone', selfService: false })).toBe(false);
        expect(isLockedAppAccount({})).toBe(false);
        expect(isLockedAppAccount(undefined)).toBe(false);
    });
});

describe('self-service callables', () => {
    it.each(SELF_SERVICE_CALLS)('%s refuses a locked app account', async (_name, fn, data) => {
        expect(await refusedAsAppManaged(call(fn, data, 'uid-locked'))).toBe(true);
    });

    it.each(SELF_SERVICE_CALLS)('%s lets an app account made with selfService: true through', async (_name, fn, data) => {
        expect(await refusedAsAppManaged(call(fn, data, 'uid-open'))).toBe(false);
    });

    it.each(SELF_SERVICE_CALLS)('%s treats an ordinary account as before', async (_name, fn, data) => {
        expect(await refusedAsAppManaged(call(fn, data, 'uid-member'))).toBe(false);
    });

    it('never deletes a locked account, even right after its sign-in', async () => {
        await expect(call(deleteMyAccount, {}, 'uid-locked')).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mem.read('users', 'locked-doc')).toBeDefined();
        await expect(call(deleteMyAccount, {}, 'uid-open')).resolves.toEqual({ deleted: true });
        expect(mem.read('users', 'open-doc')).toBeUndefined();
    });

    it('never makes a locked account the first admin', async () => {
        await expect(call(claimFirstAdmin, {}, 'uid-locked')).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mem.read('users', 'locked-doc')!['role']).toBe('user');
    });
});

describe('refreshMyClaims', () => {
    it('keeps working for a locked account signed in with the app\'s token', async () => {
        await expect(call(refreshMyClaims, {}, 'uid-locked')).resolves.toEqual({ arccms_uid: 'locked-doc' });
        expect(owner.updateUser).not.toHaveBeenCalled();
        expect(owner.revokeRefreshTokens).not.toHaveBeenCalled();
    });

    it('takes Google off a locked account signed in with it, ends its sessions and refuses', async () => {
        providers['uid-locked'] = ['google.com'];
        expect(await refusedAsAppManaged(call(refreshMyClaims, {}, 'uid-locked', 'google.com'))).toBe(true);
        expect(owner.updateUser).toHaveBeenCalledWith('uid-locked', expect.objectContaining({
            providersToUnlink: ['google.com'],
            email: 'uid-locked@moved.invalid',
            emailVerified: false,
        }));
        expect(owner.revokeRefreshTokens).toHaveBeenCalledWith('uid-locked');
        // The record never follows the link.
        expect(mem.read('users', 'locked-doc')).toMatchObject({ email: '', name: 'Anna' });
    });

    it('takes a linked phone off with phoneNumber: null, as Firebase wants', async () => {
        providers['uid-locked'] = ['phone', 'password'];
        owner.getUser.mockImplementationOnce(async (uid: string) => ({ uid, phoneNumber: '+15550100', providerData: [{ providerId: 'phone' }, { providerId: 'password' }] }));
        expect(await refusedAsAppManaged(call(refreshMyClaims, {}, 'uid-locked', 'phone'))).toBe(true);
        expect(owner.updateUser).toHaveBeenCalledWith('uid-locked', { providersToUnlink: ['password'], phoneNumber: null });
    });

    it('leaves an ordinary account and a selfService app account signed in with Google alone', async () => {
        providers['uid-member'] = ['google.com'];
        providers['uid-open'] = ['google.com'];
        await expect(call(refreshMyClaims, {}, 'uid-member', 'google.com')).resolves.toEqual({ arccms_uid: 'member-doc' });
        await expect(call(refreshMyClaims, {}, 'uid-open', 'google.com')).resolves.toEqual({ arccms_uid: 'open-doc' });
        expect(owner.updateUser).not.toHaveBeenCalled();
        expect(owner.revokeRefreshTokens).not.toHaveBeenCalled();
    });
});

describe('signing in to a locked account by another way', () => {
    it('ensureGoogleAccount refuses it and takes Google off', async () => {
        providers['uid-locked'] = ['google.com'];
        expect(await refusedAsAppManaged(call(ensureGoogleAccount, {}, 'uid-locked', 'google.com'))).toBe(true);
        expect(owner.updateUser).toHaveBeenCalledWith('uid-locked', expect.objectContaining({ providersToUnlink: ['google.com'] }));
        expect(owner.revokeRefreshTokens).toHaveBeenCalledWith('uid-locked');
    });

    it('createAccountRecord refuses a password linked to it', async () => {
        providers['uid-locked'] = ['password'];
        expect(await refusedAsAppManaged(call(createAccountRecord, { name: 'Anna' }, 'uid-locked', 'password'))).toBe(true);
        expect(owner.updateUser).toHaveBeenCalledWith('uid-locked', { providersToUnlink: ['password'] });
    });

    it('changes nothing for an ordinary account that already has a record', async () => {
        await expect(call(ensureGoogleAccount, {}, 'uid-member', 'google.com')).resolves.toEqual({ created: false });
        await expect(call(createAccountRecord, { name: 'Asha' }, 'uid-member', 'password')).resolves.toEqual({ id: 'member-doc', created: false });
        expect(owner.updateUser).not.toHaveBeenCalled();
    });
});

describe('every callable that reads the caller\'s own record has been reviewed for the lock', () => {
    const SRC = resolve(__dirname, '..');
    const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' || name === 'custom' ? [] : files(path);
        return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
    });
    const source = (path: string) => readFileSync(path, 'utf8');

    /**
     * A callable that finds the caller's own record. `guarded`: it refuses a locked app
     * account (requireOwnRecord, or its own check). Anything else says why the lock does
     * not apply. A new file here fails this test until it is added with a verdict.
     */
    const REVIEWED: Record<string, string> = {
        'auth/linkIdentifiers.ts': 'guarded',
        'auth/phoneAuth.ts': 'guarded: link codes and setPin; the sign-in steps find accounts by phone number',
        'auth/signupOtp.ts': 'guarded: link codes; sign-up codes are before sign-in',
        'auth/googleAccount.ts': 'guarded: refuses a locked account signed in with Google',
        'auth/emailAccount.ts': 'guarded: refuses a locked account signed in with a password',
        'users/accountCallables.ts': 'guarded: deleteMyAccount; refreshMyClaims must work for every account',
        'users/syncUserRole.ts': 'guarded: claimFirstAdmin; syncAllUserRoles is admin only',
        'dodo-payments/consumeCredits.ts': 'spends credits the app gave; not a change to the account',
        'email-core/notificationPrefs.ts': 'email preferences; an app account has no email, so there is nothing to change',
        'pwa/trackPwaEvent.ts': 'counts an install; not a change to the account',
        'users/adminCreateUser.ts': 'admin only',
        'email-core/announcements.ts': 'admin only',
        'email-core/adminContactFields.ts': 'admin only',
        'email-core/backfillPendingContacts.ts': 'admin only',
        'email-core/backfillContacts.ts': 'admin only',
        'email-core/migrateWaitlistedUsers.ts': 'admin only',
        'email-core/migrateTagsToContacts.ts': 'admin only',
    };

    const readsOwnRecord = (text: string) =>
        /onCall\(/.test(text)
        && /request\.auth|requireSignedIn\(|requireOwnRecord\(/.test(text)
        && /findUserByUid\(|requireOwnRecord\(|collection\('users'\)|resolveUserEmail\(/.test(text);

    it('lists every such callable, and nothing that is gone', () => {
        const found = files(SRC).filter((path) => readsOwnRecord(source(path))).map((path) => relative(SRC, path).split('\\').join('/')).sort();
        expect(found).toEqual(Object.keys(REVIEWED).sort());
    });

    it('lets only refreshMyClaims past requireOwnRecord\'s lock', () => {
        const allowed = files(SRC).flatMap((path) =>
            [...source(path).matchAll(/requireOwnRecord\(\s*request\s*,[^)]*allowLockedAppAccount/g)].map(() => relative(SRC, path).split('\\').join('/')));
        expect(allowed).toEqual(['users/accountCallables.ts']);
        expect(source(join(SRC, 'users/accountCallables.ts'))).toMatch(/refreshMyClaims = onCall\(async \(request\) => \{\n[^\n]*\n\s+const record = await requireOwnRecord\(request, \{ allowLockedAppAccount: true \}\);/);
    });

    it('guards the callables that find the record themselves', () => {
        expect(source(join(SRC, 'auth/googleAccount.ts'))).toContain('await refuseOtherSignIn(request, existing);');
        expect(source(join(SRC, 'auth/emailAccount.ts'))).toContain('await refuseOtherSignIn(request, existing);');
        expect(source(join(SRC, 'users/syncUserRole.ts'))).toContain('refuseLockedAppAccount(myDoc.data());');
    });
});
