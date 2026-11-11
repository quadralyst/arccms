/** Admin: change a member's phone number from Users > Edit user (RF4, 4.16). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    accounts: new Map<string, Record<string, unknown>>(),
    requireAdmin: vi.fn(async () => undefined),
}));
const owner = vi.hoisted(() => ({
    getUser: vi.fn(async (uid: string) => {
        const account = m.accounts.get(uid);
        if (!account) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
        return { customClaims: {}, ...account };
    }),
    getUserByPhoneNumber: vi.fn(async (phone: string) => {
        const found = [...m.accounts.values()].find((a) => a['phoneNumber'] === phone);
        if (!found) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
        return found;
    }),
    updateUser: vi.fn(async () => undefined),
    revokeRefreshTokens: vi.fn(async () => undefined),
    createCustomToken: vi.fn(async (uid: string) => `token-${uid}`),
    setCustomUserClaims: vi.fn(async () => undefined),
}));

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../search/auth', () => ({ requireAdmin: m.requireAdmin }));
vi.mock('../sign-in-choice', () => ({ signInStrength: () => 'strict', fixedSignIn: () => ({ emailSignIn: null, newDeviceCode: null }) }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error { constructor(public code: string, msg: string, public details?: unknown) { super(msg); } },
}));

import { db } from '../init.js';
import { adminSetPhone, NO_SIGN_IN, NUMBER_TAKEN, SHARED_PHONE } from '../users/adminSetPhone.js';
import * as phoneAuth from '../auth/phoneAuth.js';
import { phoneHash } from '../auth/phoneNumber.js';
import { APP_MANAGED } from '../users/lockedAppAccount.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
type Handler = (request: unknown) => Promise<any>;
const admin = (data: Record<string, unknown>) => (adminSetPhone as unknown as Handler)({ auth: { uid: 'uid-boss' }, data });
const visitor = (fn: unknown, data: Record<string, unknown>) =>
    (fn as Handler)({ data, rawRequest: { ip: '10.0.0.1', headers: {} } });

const OLD = '+919876543210';
const NEW = '+919876511111';

describe('adminSetPhone', () => {
    beforeEach(() => {
        mem.store.clear();
        m.accounts.clear();
        vi.clearAllMocks();
        mem.seed('Settings', 'users', { isSignupEnabled: true, phoneSignIn: true });
        mem.seed('users', 'asha', { uid: 'uid-asha', name: 'Asha', email: '', phone: OLD, phoneVerified: true, role: 'user', isActive: true, by: 'phone' });
        mem.seed('phone_index', phoneHash(OLD), { userDocId: 'asha', uid: 'uid-asha' });
        mem.seed('auth_pins', 'uid-asha', { hash: 'x' });
        mem.seed('auth_devices', 'uid-asha', { devices: [] });
        m.accounts.set('uid-asha', { uid: 'uid-asha' });
    });

    it('puts the new number on the record, unproved, and points the index at it', async () => {
        await expect(admin({ id: 'asha', phone: '98765 11111' })).resolves.toEqual({ updated: true, phone: NEW });
        expect(mem.read('users', 'asha')).toMatchObject({ phone: NEW, phoneVerified: false, modifiedBy: 'uid-boss' });
        expect(mem.read('phone_index', phoneHash(NEW))).toMatchObject({ userDocId: 'asha', uid: 'uid-asha' });
        expect(mem.read('phone_index', phoneHash(OLD))).toBeUndefined();
        // A sign-in account with no number of its own gets none.
        expect(owner.updateUser).not.toHaveBeenCalled();
    });

    it('ends the lost phone\'s session, and the next phone sign-in proves the new number with a code', async () => {
        await admin({ id: 'asha', phone: NEW });
        expect(owner.revokeRefreshTokens).toHaveBeenCalledWith('uid-asha');
        expect(mem.read('auth_pins', 'uid-asha')).toBeUndefined();
        expect(mem.read('auth_devices', 'uid-asha')).toBeUndefined();

        // No PIN: the sign-in page asks for a code at the new number, then a new PIN (Forgot PIN's path).
        await expect(visitor(phoneAuth.checkPhoneAccount, { phone: NEW })).resolves.toMatchObject({ exists: true, hasPin: false });
        await visitor(phoneAuth.requestPhoneOtp, { phone: NEW, purpose: 'reset' });
        const logs = mem.all('SmsLogs');
        const code = String(logs[logs.length - 1].data['text']).slice(0, 6);
        const { ticket } = await visitor(phoneAuth.verifyPhoneOtp, { phone: NEW, code, purpose: 'reset' });
        await expect(visitor(phoneAuth.resetPin, { phone: NEW, pin: '135792', ticket })).resolves.toMatchObject({ token: 'token-uid-asha' });
        expect(mem.read('users', 'asha')!['phoneVerified']).toBe(true);
        // The old number signs in to nothing.
        await expect(visitor(phoneAuth.checkPhoneAccount, { phone: OLD })).resolves.toMatchObject({ exists: false });
    });

    it('moves the sign-in account\'s own number too, when it has one', async () => {
        m.accounts.set('uid-asha', { uid: 'uid-asha', phoneNumber: OLD });
        await admin({ id: 'asha', phone: NEW });
        expect(owner.updateUser).toHaveBeenCalledWith('uid-asha', { phoneNumber: NEW });
    });

    it('keeps the lost phone out first: a sign-in account that will not take the number still loses its sessions and PIN (L1)', async () => {
        m.accounts.set('uid-asha', { uid: 'uid-asha', phoneNumber: OLD });
        owner.updateUser.mockRejectedValueOnce(new Error('auth down'));
        await expect(admin({ id: 'asha', phone: NEW })).rejects.toMatchObject({ code: 'internal' });
        expect(owner.revokeRefreshTokens).toHaveBeenCalledWith('uid-asha');
        expect(mem.read('auth_pins', 'uid-asha')).toBeUndefined();
        expect(mem.read('users', 'asha')!['phone']).toBe(NEW);
        // Trying again brings the sign-in account's number up to date.
        await expect(admin({ id: 'asha', phone: NEW })).resolves.toEqual({ updated: false, phone: NEW });
        expect(owner.updateUser).toHaveBeenLastCalledWith('uid-asha', { phoneNumber: NEW });
    });

    it('frees the number the record has when it writes, not the one it had when the call began (L2)', async () => {
        const MEANWHILE = '+919876500000';
        owner.getUserByPhoneNumber.mockImplementationOnce(async () => {
            // Someone changes the record's number while the checks run.
            mem.seed('users', 'asha', { ...mem.read('users', 'asha'), phone: MEANWHILE });
            mem.seed('phone_index', phoneHash(MEANWHILE), { userDocId: 'asha', uid: 'uid-asha' });
            throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
        });
        await admin({ id: 'asha', phone: NEW });
        expect(mem.read('phone_index', phoneHash(MEANWHILE))).toBeUndefined();
        expect(mem.read('users', 'asha')!['phone']).toBe(NEW);
    });

    it('tells a member who has an email, and only them', async () => {
        await admin({ id: 'asha', phone: NEW });
        expect(mem.all('Notifications')).toHaveLength(0);
        mem.seed('users', 'asha', { ...mem.read('users', 'asha'), email: 'asha@example.com' });
        await admin({ id: 'asha', phone: '98765 22222' });
        const [note] = mem.all('Notifications');
        expect(note.data).toMatchObject({ userId: 'uid-asha', type: 'account_security', createdBy: 'admin:uid-boss' });
        expect(String(note.data['body'])).not.toContain('98765 22222');
    });

    it('refuses a number on another account: a record, the index or a sign-in', async () => {
        mem.seed('users', 'ravi', { uid: 'uid-ravi', phone: NEW });
        await expect(admin({ id: 'asha', phone: NEW })).rejects.toMatchObject({ code: 'already-exists', message: NUMBER_TAKEN, details: { reason: 'number-taken' } });
        mem.seed('users', 'ravi', { uid: 'uid-ravi', phone: '' });
        m.accounts.set('uid-ravi', { uid: 'uid-ravi', phoneNumber: NEW });
        await expect(admin({ id: 'asha', phone: NEW })).rejects.toMatchObject({ details: { reason: 'number-taken' } });
        expect(mem.read('users', 'asha')!['phone']).toBe(OLD);
        expect(mem.read('auth_pins', 'uid-asha')).toBeDefined();
    });

    it('refuses a number that is not one, or not from an allowed country', async () => {
        await expect(admin({ id: 'asha', phone: '12' })).rejects.toMatchObject({ code: 'invalid-argument', details: { reason: 'invalid-number' } });
        await expect(admin({ id: 'asha', phone: '+44 7700 900123' })).rejects.toMatchObject({ details: { reason: 'country-not-allowed' } });
    });

    it('changes nothing for the number the record already has', async () => {
        await expect(admin({ id: 'asha', phone: OLD })).resolves.toEqual({ updated: false, phone: OLD });
        expect(mem.read('auth_pins', 'uid-asha')).toBeDefined();
    });

    it('refuses a locked app account, a shared sign-in, no sign-in, and a record that is gone', async () => {
        mem.seed('users', 'till', { uid: 'uid-till', by: 'app' });
        await expect(admin({ id: 'till', phone: NEW })).rejects.toMatchObject({ message: APP_MANAGED, details: { reason: 'app-managed' } });
        mem.seed('users', 'host', { uid: 'uid-host', authOwner: 'shared' });
        await expect(admin({ id: 'host', phone: NEW })).rejects.toMatchObject({ message: SHARED_PHONE, details: { reason: 'shared-account' } });
        mem.seed('users', 'none', { name: 'No sign-in' });
        await expect(admin({ id: 'none', phone: NEW })).rejects.toMatchObject({ message: NO_SIGN_IN, details: { reason: 'no-account' } });
        m.accounts.delete('uid-asha');
        await expect(admin({ id: 'asha', phone: NEW })).rejects.toMatchObject({ details: { reason: 'no-account' } });
        await expect(admin({ id: 'gone', phone: NEW })).rejects.toMatchObject({ code: 'not-found' });
    });

    it('is for admins only', async () => {
        m.requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Admin access required.'), { code: 'permission-denied' }));
        await expect(admin({ id: 'asha', phone: NEW })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mem.read('users', 'asha')!['phone']).toBe(OLD);
    });
});
