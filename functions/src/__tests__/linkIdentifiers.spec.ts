/**
 * Adding an email or phone number to an account, and moving one that is on
 * another account, end to end through the callables.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    updateUser: vi.fn(),
    createCustomToken: vi.fn(async (uid: string) => `token-${uid}`),
}));
const mocks = vi.hoisted(() => ({
    queueEmail: vi.fn(),
    createNotification: vi.fn(),
    notifyAdmins: vi.fn(),
    upsertContact: vi.fn(),
    unlinkUserContact: vi.fn(),
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
// The app's password and PIN strength (src/custom/sign-in.ts): strict unless a test says simple.
const strength = vi.hoisted(() => ({ value: 'strict' as 'strict' | 'simple' }));
vi.mock('../sign-in-choice', () => ({ signInStrength: () => strength.value, fixedSignIn: () => ({ emailSignIn: null, newDeviceCode: null }) }));
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
vi.mock('../email-core/notifications', () => ({ createNotification: mocks.createNotification }));
vi.mock('../email-core/adminAlerts', () => ({ notifyAdmins: mocks.notifyAdmins }));
vi.mock('../email-core/contacts', () => ({
    SYSTEM_LISTS: { ALL_USERS: 'all-users' },
    ensureSystemLists: vi.fn(),
    upsertContact: mocks.upsertContact,
    unlinkUserContact: mocks.unlinkUserContact,
}));

import { db } from '../init.js';
import * as phone from '../auth/phoneAuth.js';
import * as link from '../auth/linkIdentifiers.js';
import { verifySignupOtp } from '../auth/signupOtp.js';
import { phoneHash } from '../auth/phoneNumber.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { FakeTimestamp, type MemoryFirestore } from './helpers/memoryFirestore.js';
import { newOtpTicket } from '../auth/otpTicket.js';

const mem = db as unknown as MemoryFirestore;
type Handler = (request: unknown) => Promise<any>;
const call = (fn: unknown, data: Record<string, unknown>, uid?: string) =>
    (fn as Handler)({ data, auth: uid ? { uid, token: {} } : undefined, rawRequest: { ip: '10.0.0.1', headers: {} } });

const B_PHONE = '+919876543210';

/** A fresh-code proof for this account and kind, as confirmFreshCode leaves one (docs/app/fresh-code.html). */
function freshProof(uid: string, kind: 'email' | 'phone'): string {
    const purpose = kind === 'email' ? 'link-email' : 'link-phone';
    const { ticket, ticketHash } = newOtpTicket();
    mem.seed('auth_fresh_proofs', `${uid}__${purpose}`, { uid, purpose, proofHash: ticketHash, expiresAt: FakeTimestamp.fromMillis(Date.now() + 300_000) });
    return ticket;
}

/** linkPhone or linkEmail with a fresh-code proof, as the profile page sends them. */
const linked = (fn: unknown, data: Record<string, unknown>, uid: string) =>
    call(fn, { ...data, freshProof: freshProof(uid, fn === link.linkEmail ? 'email' : 'phone') }, uid);

function lastSmsCode(): string {
    const logs = mem.all('SmsLogs');
    return String(logs[logs.length - 1].data['text']).slice(0, 6);
}

function lastEmailCode(): string {
    const calls = mocks.queueEmail.mock.calls;
    return calls[calls.length - 1][0].data.otp;
}

/** Providers per uid, for owner.getUser. */
let providers: Record<string, string[]>;

beforeEach(() => {
    mem.store.clear();
    vi.clearAllMocks();
    strength.value = 'strict';
    providers = { 'uid-a': ['password'], 'uid-b': [] };
    owner.getUser.mockImplementation(async (uid: string) => ({ uid, providerData: (providers[uid] ?? []).map((providerId) => ({ providerId })) }));
    owner.getUserByEmail.mockRejectedValue(Object.assign(new Error('not found'), { code: 'auth/user-not-found' }));
    mocks.queueEmail.mockResolvedValue({ id: 'log', status: 'pending' });
    mem.seed('EmailTemplate', 't1', { type: 'signup_otp_email', senderEmail: 's@x.com', senderName: 'S', subject: 'Code', template: '##OTP##' });
    mem.seed('Settings', 'users', { isSignupEnabled: true, phoneSignIn: true });
    mem.seed('users', 'a-doc', { uid: 'uid-a', name: 'Asha', email: 'asha@example.com', role: 'user', isActive: true, status: 'Active' });
    mem.seed('users', 'b-doc', { uid: 'uid-b', name: 'Old Asha', email: '', phone: B_PHONE, phoneVerified: true, role: 'user', isActive: true, status: 'Active' });
    mem.seed('phone_index', phoneHash(B_PHONE), { userDocId: 'b-doc', uid: 'uid-b' });
    mem.seed('auth_pins', 'uid-b', { salt: 'aa', hash: 'bb', failedAttempts: 0 });
});

async function verifyPhoneForA(): Promise<void> {
    await call(phone.requestPhoneOtp, { phone: '98765 43210', purpose: 'link' }, 'uid-a');
    await call(phone.verifyPhoneOtp, { phone: '98765 43210', code: lastSmsCode(), purpose: 'link' }, 'uid-a');
}

describe('checkIdentifierForLink', () => {
    it('says a number is on another account, and that a PIN is still needed', async () => {
        await expect(call(link.checkIdentifierForLink, { identifier: '+91 98765-43210' }, 'uid-a')).resolves.toEqual({
            kind: 'phone', value: B_PHONE, status: 'other', needsPin: true,
        });
    });

    it('says an unused email is available and a password is already set', async () => {
        await expect(call(link.checkIdentifierForLink, { identifier: ' New@Example.com ' }, 'uid-a')).resolves.toEqual({
            kind: 'email', value: 'new@example.com', status: 'available', needsPassword: false,
        });
    });

    it("says an email held by a sign-in with no ArcCMS record (another app's user) cannot move", async () => {
        owner.getUserByEmail.mockResolvedValue({ uid: 'host-uid', providerData: [] });
        await expect(call(link.checkIdentifierForLink, { identifier: 'host@example.com' }, 'uid-a'))
            .resolves.toMatchObject({ status: 'blocked' });
    });
});

describe('linkPhone', () => {
    it('moves the only sign-in of the other account here and detaches that account', async () => {
        await verifyPhoneForA();
        await expect(linked(link.linkPhone, { phone: '9876543210', pin: '246810' }, 'uid-a')).resolves.toEqual({ linked: true, moved: true });

        expect(mem.read('users', 'a-doc')).toMatchObject({ phone: B_PHONE, phoneVerified: true });
        expect(mem.read('phone_index', phoneHash(B_PHONE))).toMatchObject({ userDocId: 'a-doc', uid: 'uid-a' });
        const b = mem.read('users', 'b-doc')!;
        expect(b['phone']).toBeUndefined();
        expect(b).toMatchObject({ status: 'Detached', isActive: false, detachedReason: 'phone_moved' });
        expect(mem.read('auth_pins', 'uid-b')).toBeUndefined();
        expect(mem.read('auth_pins', 'uid-a')).toBeDefined();
        expect(mem.all('account_transfers')[0].data).toMatchObject({ kind: 'phone', fromUid: 'uid-b', toUid: 'uid-a', detached: true });
        expect(mocks.notifyAdmins).toHaveBeenCalledWith('admin_account_detached', expect.anything());
        expect(mocks.createNotification).not.toHaveBeenCalled();
    });

    it('leaves an account that still has an email active, and tells its owner', async () => {
        mem.seed('users', 'b-doc', { ...mem.read('users', 'b-doc'), email: 'old@example.com' });
        await verifyPhoneForA();
        await linked(link.linkPhone, { phone: '9876543210', pin: '246810' }, 'uid-a');

        expect(mem.read('users', 'b-doc')).toMatchObject({ status: 'Active', isActive: true, email: 'old@example.com' });
        expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'uid-b', type: 'account_security' }));
        expect(mocks.notifyAdmins).not.toHaveBeenCalled();
    });

    it('asks for a PIN when the account has none yet', async () => {
        await verifyPhoneForA();
        await expect(linked(link.linkPhone, { phone: '9876543210' }, 'uid-a'))
            .rejects.toMatchObject({ details: { reason: 'pin-required' } });
    });

    it('refuses a first PIN that is easy to guess, and takes it when the app chose simple PINs', async () => {
        await verifyPhoneForA();
        await expect(linked(link.linkPhone, { phone: '9876543210', pin: '123456' }, 'uid-a'))
            .rejects.toMatchObject({ code: 'invalid-argument', details: { reason: 'weak-pin' } });
        strength.value = 'simple';
        await expect(linked(link.linkPhone, { phone: '9876543210', pin: '123456' }, 'uid-a')).resolves.toMatchObject({ linked: true });
    });

    it("cannot use a code someone else verified", async () => {
        await verifyPhoneForA();
        mem.seed('users', 'c-doc', { uid: 'uid-c', name: 'C', email: 'c@example.com', isActive: true, status: 'Active' });
        await expect(linked(link.linkPhone, { phone: '9876543210', pin: '246810' }, 'uid-c'))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mem.read('users', 'b-doc')!['phone']).toBe(B_PHONE);
    });

    it('frees the old number when changing to a new one', async () => {
        const OLD = '+919812345678';
        mem.seed('users', 'a-doc', { ...mem.read('users', 'a-doc'), phone: OLD });
        mem.seed('phone_index', phoneHash(OLD), { userDocId: 'a-doc', uid: 'uid-a' });
        mem.seed('auth_pins', 'uid-a', { salt: 'aa', hash: 'bb', failedAttempts: 0 });
        await verifyPhoneForA();
        await linked(link.linkPhone, { phone: '9876543210' }, 'uid-a');
        expect(mem.read('phone_index', phoneHash(OLD))).toBeUndefined();
    });

    it('never replaces a PIN the account has: changing it needs the old one (setPin)', async () => {
        const pinBefore = { salt: 'aa', hash: 'bb', failedAttempts: 0 };
        mem.seed('auth_pins', 'uid-a', pinBefore);
        await verifyPhoneForA();
        await expect(linked(link.linkPhone, { phone: '9876543210', pin: '135792' }, 'uid-a')).resolves.toMatchObject({ linked: true });
        expect(mem.read('auth_pins', 'uid-a')).toEqual(pinBefore);
    });
});

describe('linkEmail', () => {
    async function verifyEmailForA(email: string): Promise<void> {
        await call(link.requestEmailLinkOtp, { email }, 'uid-a');
        await call(verifySignupOtp, { email, code: lastEmailCode(), purpose: 'link' }, 'uid-a');
    }

    it('with the Simulated email provider, says so but never hands the code back (Email Logs only)', async () => {
        mem.seed('Settings', 'email', { isEnabled: true, activeProvider: 'debug_log' });
        await expect(call(link.requestEmailLinkOtp, { email: 'new@example.com' }, 'uid-a')).resolves.toEqual({ sent: true, testMode: true });
    });

    it('changes the email after the code, and swaps the lookup entries', async () => {
        await verifyEmailForA('new@example.com');
        await expect(linked(link.linkEmail, { email: 'new@example.com' }, 'uid-a')).resolves.toEqual({ linked: true, moved: false });

        expect(owner.updateUser).toHaveBeenCalledWith('uid-a', { email: 'new@example.com', emailVerified: true });
        expect(mem.read('users', 'a-doc')).toMatchObject({ email: 'new@example.com', emailVerified: true });
        expect(mem.read('email_lookup', computeEmailHash('new@example.com'))).toEqual({ exists: true });
        expect(mem.read('email_lookup', computeEmailHash('asha@example.com'))).toBeUndefined();
        expect(mocks.upsertContact).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.com', userId: 'uid-a' }));
    });

    it('moves an email from another account, releasing it on that sign-in and unlinking its Google', async () => {
        mem.seed('users', 'b-doc', { ...mem.read('users', 'b-doc'), email: 'old@example.com' });
        owner.getUserByEmail.mockResolvedValue({ uid: 'uid-b', providerData: [{ providerId: 'password' }, { providerId: 'google.com' }] });
        await verifyEmailForA('old@example.com');
        await expect(linked(link.linkEmail, { email: 'old@example.com' }, 'uid-a')).resolves.toEqual({ linked: true, moved: true });

        expect(owner.updateUser).toHaveBeenCalledWith('uid-b', {
            email: 'uid-b@moved.invalid', emailVerified: false, providersToUnlink: ['password', 'google.com'],
        });
        // B keeps its phone, so it is not detached.
        expect(mem.read('users', 'b-doc')).toMatchObject({ email: '', status: 'Active', phone: B_PHONE });
        expect(mem.all('account_transfers')[0].data).toMatchObject({ kind: 'email', detached: false });
    });

    it('a phone-only account sets a password with its first email', async () => {
        providers['uid-a'] = [];
        await verifyEmailForA('new@example.com');
        await expect(linked(link.linkEmail, { email: 'new@example.com' }, 'uid-a'))
            .rejects.toMatchObject({ details: { reason: 'password-required' } });
        await linked(link.linkEmail, { email: 'new@example.com', password: 'longenough' }, 'uid-a');
        expect(owner.updateUser).toHaveBeenCalledWith('uid-a', { email: 'new@example.com', emailVerified: true, password: 'longenough' });
    });

    it('refuses a first password that is too easy to guess, saying why, and keeps the verified code (F22)', async () => {
        providers['uid-a'] = [];
        await verifyEmailForA('new@example.com');
        await expect(linked(link.linkEmail, { email: 'new@example.com', password: 'Password123!' }, 'uid-a'))
            .rejects.toMatchObject({ code: 'invalid-argument', details: { reason: 'weak-password', problem: 'common' } });
        await expect(linked(link.linkEmail, { email: 'new@example.com', password: 'Asha@2024' }, 'uid-a'))
            .rejects.toMatchObject({ details: { reason: 'weak-password', problem: 'personal' } });
        expect(owner.updateUser).not.toHaveBeenCalled();
        await expect(linked(link.linkEmail, { email: 'new@example.com', password: 'Monsoon-Train-42' }, 'uid-a')).resolves.toMatchObject({ linked: true });
    });

    it('says the shortest length with a missing password: 8, or 6 when the app chose simple passwords', async () => {
        providers['uid-a'] = [];
        await verifyEmailForA('new@example.com');
        await expect(linked(link.linkEmail, { email: 'new@example.com', password: 'abc1234' }, 'uid-a'))
            .rejects.toMatchObject({ details: { reason: 'password-required', min: 8 } });
        strength.value = 'simple';
        await expect(linked(link.linkEmail, { email: 'new@example.com', password: 'abc12' }, 'uid-a'))
            .rejects.toMatchObject({ message: 'Choose a password of at least 6 characters.', details: { reason: 'password-required', min: 6 } });
        // Short, common and personal are all fine once it has 6 characters.
        await expect(linked(link.linkEmail, { email: 'new@example.com', password: 'asha12' }, 'uid-a')).resolves.toMatchObject({ linked: true });
        expect(owner.updateUser).toHaveBeenCalledWith('uid-a', { email: 'new@example.com', emailVerified: true, password: 'asha12' });
    });

    it('never touches a sign-in that belongs to another app', async () => {
        owner.getUserByEmail.mockResolvedValue({ uid: 'host-uid', providerData: [] });
        await verifyEmailForA('host@example.com');
        await expect(linked(link.linkEmail, { email: 'host@example.com' }, 'uid-a')).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(owner.updateUser).not.toHaveBeenCalled();
    });

    it('needs the code verified by this same account', async () => {
        await expect(linked(link.linkEmail, { email: 'new@example.com' }, 'uid-a')).rejects.toMatchObject({ code: 'failed-precondition' });
    });
});

describe('a fresh code before adding or changing a way in (a session alone is not enough)', () => {
    it('refuses linkPhone without a fresh code and keeps the number\'s code, so the page can ask and try again', async () => {
        await verifyPhoneForA();
        await expect(call(link.linkPhone, { phone: '9876543210', pin: '246810' }, 'uid-a'))
            .rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'fresh-code-required' } });
        expect(mem.read('users', 'a-doc')!['phone']).toBeUndefined();
        // Another person's proof, or one for the other kind, is no proof.
        await expect(call(link.linkPhone, { phone: '9876543210', pin: '246810', freshProof: freshProof('uid-b', 'phone') }, 'uid-a'))
            .rejects.toMatchObject({ details: { reason: 'fresh-code-required' } });
        await expect(call(link.linkPhone, { phone: '9876543210', pin: '246810', freshProof: freshProof('uid-a', 'email') }, 'uid-a'))
            .rejects.toMatchObject({ details: { reason: 'fresh-code-required' } });
        await expect(linked(link.linkPhone, { phone: '9876543210', pin: '246810' }, 'uid-a')).resolves.toMatchObject({ linked: true });
    });

    it('so a session cannot add its own number and then reset the PIN through it (linkPhone then resetPin)', async () => {
        const MINE = '+919811112222';
        mem.seed('auth_pins', 'uid-a', { salt: 'aa', hash: 'bb', failedAttempts: 0 });
        // The session verifies a number it holds...
        await call(phone.requestPhoneOtp, { phone: MINE, purpose: 'link' }, 'uid-a');
        await call(phone.verifyPhoneOtp, { phone: MINE, code: lastSmsCode(), purpose: 'link' }, 'uid-a');
        // ...but cannot put it on the account without the owner's fresh code.
        await expect(call(link.linkPhone, { phone: MINE }, 'uid-a')).rejects.toMatchObject({ details: { reason: 'fresh-code-required' } });
        // Forgot PIN on that number finds no account to take over.
        await call(phone.requestPhoneOtp, { phone: MINE, purpose: 'reset' }).catch(() => undefined);
        await expect(call(phone.resetPin, { phone: MINE, pin: '864209', ticket: 'x'.repeat(32) }))
            .rejects.toMatchObject({ details: { reason: 'no-account' } });
        expect(mem.read('auth_pins', 'uid-a')).toMatchObject({ hash: 'bb' });
    });

    it('refuses linkEmail without a fresh code, the same way (linkEmail then a reset)', async () => {
        await call(link.requestEmailLinkOtp, { email: 'mine@example.com' }, 'uid-a');
        await call(verifySignupOtp, { email: 'mine@example.com', code: lastEmailCode(), purpose: 'link' }, 'uid-a');
        await expect(call(link.linkEmail, { email: 'mine@example.com' }, 'uid-a'))
            .rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'fresh-code-required' } });
        expect(owner.updateUser).not.toHaveBeenCalled();
        expect(mem.read('users', 'a-doc')!['email']).toBe('asha@example.com');
    });

    it('needs none for an account with no way in yet (no email, number, PIN or password)', async () => {
        mem.seed('users', 'n-doc', { uid: 'uid-n', name: 'New', email: '', role: 'user', isActive: true, status: 'Active' });
        providers['uid-n'] = [];
        await call(phone.requestPhoneOtp, { phone: '9811133333', purpose: 'link' }, 'uid-n');
        await call(phone.verifyPhoneOtp, { phone: '9811133333', code: lastSmsCode(), purpose: 'link' }, 'uid-n');
        await expect(call(link.linkPhone, { phone: '9811133333', pin: '246810' }, 'uid-n')).resolves.toMatchObject({ linked: true });
    });

    it('tells the old address when an email is replaced', async () => {
        await call(link.requestEmailLinkOtp, { email: 'new@example.com' }, 'uid-a');
        await call(verifySignupOtp, { email: 'new@example.com', code: lastEmailCode(), purpose: 'link' }, 'uid-a');
        mocks.queueEmail.mockClear();
        await linked(link.linkEmail, { email: 'new@example.com' }, 'uid-a');
        expect(mocks.queueEmail).toHaveBeenCalledWith(expect.objectContaining({
            toEmail: 'asha@example.com', source: 'auth', category: 'transactional', type: 'email_changed_email',
        }));
        const sent = mocks.queueEmail.mock.calls[0][0];
        expect(sent.text).toContain('n•••@example.com');
        expect(sent.text).not.toContain('new@example.com');
        expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'uid-a', type: 'account_security' }));
    });

    it('tells the person, on their email, when a number replaces another', async () => {
        const OLD = '+919812345678';
        mem.seed('users', 'a-doc', { ...mem.read('users', 'a-doc'), phone: OLD });
        mem.seed('auth_pins', 'uid-a', { salt: 'aa', hash: 'bb', failedAttempts: 0 });
        await verifyPhoneForA();
        mocks.queueEmail.mockClear();
        await linked(link.linkPhone, { phone: '9876543210' }, 'uid-a');
        expect(mocks.queueEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: 'asha@example.com', type: 'phone_changed_email' }));
        expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'uid-a', title: 'Your phone number was changed' }));
    });

    it('tells nobody when a first number or email is added', async () => {
        await verifyPhoneForA();
        mocks.queueEmail.mockClear();
        await linked(link.linkPhone, { phone: '9876543210', pin: '246810' }, 'uid-a');
        expect(mocks.queueEmail).not.toHaveBeenCalled();
    });
});

describe("never detaching the site's last active admin (RF4, M3)", () => {
    beforeEach(() => {
        // B, whose only way in is the number, is the site's only admin.
        mem.seed('users', 'b-doc', { ...mem.read('users', 'b-doc'), role: 'admin' });
    });

    it('refuses to move the number off it, before any code is used up', async () => {
        await verifyPhoneForA();
        await expect(linked(link.linkPhone, { phone: '9876543210', pin: '246810' }, 'uid-a')).rejects.toMatchObject({
            code: 'failed-precondition', message: link.LAST_ADMIN_SIGN_IN, details: { reason: 'last-admin' },
        });
        expect(mem.read('users', 'b-doc')).toMatchObject({ phone: B_PHONE, isActive: true, status: 'Active' });
        expect(mem.read('phone_index', phoneHash(B_PHONE))).toMatchObject({ userDocId: 'b-doc' });
        expect(mem.read('auth_pins', 'uid-b')).toBeDefined();
    });

    it('moves it once another admin is active, or when the admin keeps another way in', async () => {
        mem.seed('users', 'c-doc', { uid: 'uid-c', role: 'admin', isActive: true, status: 'Active' });
        await verifyPhoneForA();
        await expect(linked(link.linkPhone, { phone: '9876543210', pin: '246810' }, 'uid-a')).resolves.toMatchObject({ moved: true });
        expect(mem.read('users', 'b-doc')).toMatchObject({ status: 'Detached' });
    });

    it('refuses to move the only email off the last admin too', async () => {
        mem.seed('users', 'b-doc', { uid: 'uid-b', name: 'Boss', email: 'boss@example.com', phone: '', role: 'admin', isActive: true, status: 'Active' });
        owner.getUserByEmail.mockResolvedValue({ uid: 'uid-b', providerData: [{ providerId: 'password' }] });
        await call(link.requestEmailLinkOtp, { email: 'boss@example.com' }, 'uid-a');
        await call(verifySignupOtp, { email: 'boss@example.com', code: lastEmailCode(), purpose: 'link' }, 'uid-a');
        await expect(linked(link.linkEmail, { email: 'boss@example.com' }, 'uid-a')).rejects.toMatchObject({ details: { reason: 'last-admin' } });
        expect(mem.read('users', 'b-doc')).toMatchObject({ email: 'boss@example.com', status: 'Active' });
        expect(owner.updateUser).not.toHaveBeenCalled();
    });
});
