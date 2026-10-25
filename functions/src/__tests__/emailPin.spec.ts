/**
 * Email sign-in with a PIN (F31 part 1, specs/sign-in-pin-spec.md), on an in-memory
 * Firestore with the real code, PIN, device and claims code: only Firebase Auth and
 * the email send are replaced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const claims = vi.hoisted(() => ({} as Record<string, Record<string, unknown>>));
const accounts = vi.hoisted(() => ({} as Record<string, { uid: string; email?: string; providerData: Array<{ providerId: string }>; metadata: { creationTime: string } }>));
const owner = vi.hoisted(() => ({
    createUser: vi.fn(async (input: { email: string }) => {
        const uid = `uid-${Object.keys(accounts).length + 1}`;
        accounts[uid] = { uid, email: input.email, providerData: [], metadata: { creationTime: new Date().toUTCString() } };
        return accounts[uid];
    }),
    deleteUser: vi.fn(),
    createCustomToken: vi.fn(async (uid: string) => `token-${uid}`),
    getUser: vi.fn(async (uid: string) => ({ ...(accounts[uid] ?? { uid, providerData: [] }), customClaims: claims[uid] ?? {} })),
    getUserByEmail: vi.fn(async (email: string) => {
        const found = Object.values(accounts).find((a) => a.email === email);
        if (!found) throw Object.assign(new Error('nope'), { code: 'auth/user-not-found' });
        return found;
    }),
    updateUser: vi.fn(async (uid: string, change: { providersToUnlink?: string[] }) => {
        const a = accounts[uid];
        if (a && change.providersToUnlink) a.providerData = a.providerData.filter((p) => !change.providersToUnlink!.includes(p.providerId));
    }),
    setCustomUserClaims: vi.fn(async (uid: string, next: Record<string, unknown>) => { claims[uid] = next; }),
    revokeRefreshTokens: vi.fn(),
}));
const sent = vi.hoisted(() => ({ emails: [] as Array<Record<string, any>> }));

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((handler: unknown) => handler),
    HttpsError: class extends Error {
        constructor(public code: string, message: string, public details?: unknown) { super(message); }
    },
}));
vi.mock('../users/claimLock.js', () => ({ withClaimLock: (_uid: string, work: () => Promise<unknown>) => work() }));
vi.mock('../email-core/queueEmail', () => ({
    queueEmail: vi.fn(async (input: Record<string, unknown>) => { sent.emails.push(input); return { id: 'log', status: 'pending' }; }),
}));
vi.mock('../email-core/defaultTemplates', () => ({ ensureDefaultTemplates: vi.fn(async () => ({ created: [], skipped: [] })) }));
vi.mock('../email-core/appEmailTemplates', () => ({ accountEmailInLanguage: vi.fn(async () => null) }));

import { db } from '../init.js';
import * as pin from '../auth/emailPin.js';
import { checkEmailAccount } from '../auth/emailAccount.js';
import { verifySignupOtp } from '../auth/signupOtp.js';
import { requestPasswordReset } from '../auth/passwordReset.js';
import { setPin as changePin } from '../auth/setPin.js';
import { AUTH_PINS, checkPin, setPin } from '../auth/accounts.js';
import { AUTH_DEVICES } from '../auth/devices.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
type Handler = (request: unknown) => Promise<any>;
const call = (fn: unknown, data: Record<string, unknown>, uid?: string) =>
    (fn as Handler)({ data, auth: uid ? { uid, token: {} } : undefined, rawRequest: { ip: '10.0.0.1', headers: {} } });

const EMAIL = 'asha@example.com';
const PHONE_KEY = 'k'.repeat(43);
const OTHER_KEY = 'o'.repeat(43);
const lastCode = () => String(sent.emails.at(-1)?.data?.otp);
const lastTemplate = () => String(sent.emails.at(-1)?.type);

/** Let another code go: the last one went over a minute ago. */
function ageCode(): void {
    const [doc] = mem.all('signup_otps');
    if (doc) mem.seed('signup_otps', doc.id, { ...doc.data, lastSentAt: { toMillis: () => Date.now() - 120_000 } });
}

function settings(extra: Record<string, unknown>): void {
    mem.seed('Settings', 'users', { isSignupEnabled: true, ...extra });
}

/** An existing email account: its sign-in (with a password, or not) and its record. */
function person(uid: string, opts: { password?: boolean; role?: string; authOwner?: string; email?: string } = {}): void {
    const email = opts.email ?? EMAIL;
    accounts[uid] = { uid, email, providerData: opts.password ? [{ providerId: 'password' }] : [], metadata: { creationTime: new Date(0).toUTCString() } };
    mem.seed('users', `rec-${uid}`, {
        uid, email, name: 'Asha', role: opts.role ?? 'user', isActive: true, status: 'Active', by: 'email', ...(opts.authOwner ? { authOwner: opts.authOwner } : {}),
    });
}

beforeEach(() => {
    mem.store.clear();
    vi.clearAllMocks();
    sent.emails = [];
    for (const k of Object.keys(claims)) delete claims[k];
    for (const k of Object.keys(accounts)) delete accounts[k];
    mem.seed('EmailTemplate', 't1', { type: 'signup_otp_email', subject: 'Your verification code', template: '##OTP##', isActive: true });
    mem.seed('EmailTemplate', 't2', { type: 'pin_reset_otp_email', subject: 'Your PIN reset code', template: '##OTP##', isActive: true });
    settings({ emailSignIn: 'pin', newDeviceCode: true });
});

describe('what a registered email signs in with (the table in the spec)', () => {
    const at = (eligible: boolean, hasPin: boolean, password: boolean, emailPin: boolean) => pin.emailSignInWith({ eligible, pin: hasPin, password, emailPin });

    it('asks each account for what it has, whatever the setting says', () => {
        // setting PIN
        expect(at(true, false, true, true)).toBe('password'); // password only: the password, then a PIN is offered
        expect(at(true, true, false, true)).toBe('pin');
        expect(at(true, true, true, true)).toBe('pin');
        expect(at(true, false, false, true)).toBe('code'); // neither (Google only): a code, then a first PIN
        // setting Password
        expect(at(true, false, true, false)).toBe('password');
        expect(at(true, true, false, false)).toBe('pin'); // keeps the PIN it has
        expect(at(true, true, true, false)).toBe('password');
        expect(at(true, false, false, false)).toBe('password');
        // a login another app owns, or a locked app account: always as before
        expect(at(false, true, false, true)).toBe('password');
    });
});

describe('checkEmailAccount for a registered address', () => {
    it('a PIN account on a device not proved yet: the code comes first, and the check sends it', async () => {
        person('u1');
        await setPin('u1', '604175');
        const reply = await call(checkEmailAccount, { email: EMAIL, deviceKey: PHONE_KEY, sendCode: true });
        expect(reply).toMatchObject({ status: 'registered', signInWith: 'pin', deviceCode: true, code: { sent: true } });
        expect(lastTemplate()).toBe('signup_otp_email');
    });

    it('a PIN account on a known device: straight to the PIN, nothing sent', async () => {
        person('u1');
        await setPin('u1', '604175');
        const { rememberDevice } = await import('../auth/devices.js');
        await rememberDevice('u1', PHONE_KEY);
        const reply = await call(checkEmailAccount, { email: EMAIL, deviceKey: PHONE_KEY, sendCode: true });
        expect(reply).toEqual({ status: 'registered', signupOpen: true, signInWith: 'pin' });
        expect(sent.emails).toHaveLength(0);
    });

    it('a password account, with the site on PINs: the password, and a PIN offered after; never to an admin', async () => {
        person('u1', { password: true });
        await expect(call(checkEmailAccount, { email: EMAIL })).resolves.toMatchObject({ signInWith: 'password', offerPin: true });
        mem.store.clear();
        settings({ emailSignIn: 'pin' });
        person('a1', { password: true, role: 'admin', email: 'boss@example.com' });
        const admin = await call(checkEmailAccount, { email: 'boss@example.com' });
        expect(admin.signInWith).toBe('password');
        expect(admin.offerPin).toBeUndefined();
    });

    it('an account with neither, with the site on PINs: a PIN reset code, then a first PIN', async () => {
        person('u1');
        await expect(call(checkEmailAccount, { email: EMAIL, sendCode: true })).resolves.toMatchObject({ signInWith: 'code', code: { sent: true } });
        expect(lastTemplate()).toBe('pin_reset_otp_email');
    });

    it('a login another app owns keeps its password, whatever the setting', async () => {
        person('u1', { password: true, authOwner: 'host' });
        await setPin('u1', '604175');
        const reply = await call(checkEmailAccount, { email: EMAIL, sendCode: true });
        expect(reply.signInWith).toBe('password');
        expect(reply.offerPin).toBeUndefined();
        expect(sent.emails).toHaveLength(0);
    });

    it('with the site on passwords, nothing changes for a password account', async () => {
        settings({});
        person('u1', { password: true });
        await expect(call(checkEmailAccount, { email: EMAIL })).resolves.toEqual({ status: 'registered', signupOpen: true, signInWith: 'password' });
    });
});

describe('sign-up with a PIN', () => {
    async function signUp(deviceKey = PHONE_KEY) {
        await call(checkEmailAccount, { email: EMAIL, sendCode: true });
        const { ticket } = await call(verifySignupOtp, { email: EMAIL, code: lastCode() });
        return call(pin.completeEmailSignup, { email: EMAIL, name: 'Asha Rao', pin: '604175', ticket, deviceKey });
    }

    it('makes the account with no password, a verified email, the PIN, the claims and this device, and signs in', async () => {
        settings({ emailSignIn: 'pin', newDeviceCode: true, defaultRole: 'user' });
        await expect(signUp()).resolves.toEqual({ token: 'token-uid-1' });
        expect(owner.createUser).toHaveBeenCalledWith({ email: EMAIL, emailVerified: true, displayName: 'Asha Rao' });
        const [record] = mem.all('users');
        expect(record.data).toMatchObject({ uid: 'uid-1', email: EMAIL, emailVerified: true, by: 'email', role: 'user', phone: '' });
        expect(claims['uid-1']).toMatchObject({ arccms_uid: record.id, arccms_role: 'user' });
        await expect(checkPin('uid-1', '604175')).resolves.toEqual({ ok: true });
        expect((mem.read(AUTH_DEVICES, 'uid-1')?.['devices'] as unknown[]).length).toBe(1);
        // Signed up on this device: no code to sign in here next time
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '604175', deviceKey: PHONE_KEY })).resolves.toEqual({ token: 'token-uid-1' });
    });

    it('needs the verified code with its ticket, the site on PINs, and an address nobody has', async () => {
        await call(checkEmailAccount, { email: EMAIL, sendCode: true });
        await call(verifySignupOtp, { email: EMAIL, code: lastCode() });
        await expect(call(pin.completeEmailSignup, { email: EMAIL, name: 'Asha Rao', pin: '604175', ticket: 'stolen' }))
            .rejects.toMatchObject({ details: { reason: 'code-expired' } });
        settings({});
        await expect(call(pin.completeEmailSignup, { email: EMAIL, name: 'Asha Rao', pin: '604175' })).rejects.toMatchObject({ details: { reason: 'pin-sign-in-off' } });
        settings({ emailSignIn: 'pin' });
        accounts['other'] = { uid: 'other', email: EMAIL, providerData: [], metadata: { creationTime: '' } };
        await expect(call(pin.completeEmailSignup, { email: EMAIL, name: 'Asha Rao', pin: '604175' })).rejects.toMatchObject({ details: { reason: 'email-has-account' } });
        expect(owner.createUser).not.toHaveBeenCalled();
    });

    it('refuses a PIN too easy to guess under the strict rule', async () => {
        await expect(call(pin.completeEmailSignup, { email: EMAIL, name: 'Asha Rao', pin: '123456' })).rejects.toMatchObject({ details: { reason: 'weak-pin' } });
    });
});

describe('signInWithEmailPin', () => {
    beforeEach(async () => {
        person('u1');
        await setPin('u1', '604175');
    });

    it('on a device not proved yet: no PIN try at all until a device code is verified', async () => {
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '604175', deviceKey: PHONE_KEY })).rejects.toMatchObject({ details: { reason: 'new-device' } });
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '000000', deviceKey: PHONE_KEY })).rejects.toMatchObject({ details: { reason: 'new-device' } });
        expect(mem.read(AUTH_PINS, 'u1')?.['failedAttempts']).toBe(0);

        await call(pin.requestEmailPinCode, { email: EMAIL, purpose: 'device' });
        const { ticket } = await call(verifySignupOtp, { email: EMAIL, code: lastCode(), purpose: 'device' });
        // A wrong PIN costs a try but leaves the device code good for the next one
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '111111', deviceKey: PHONE_KEY, ticket })).rejects.toMatchObject({ details: { reason: 'wrong', remaining: 4 } });
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '604175', deviceKey: PHONE_KEY, ticket })).resolves.toEqual({ token: 'token-u1' });
        // The device is now known, and the code is used up
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '604175', deviceKey: PHONE_KEY })).resolves.toEqual({ token: 'token-u1' });
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '604175', deviceKey: OTHER_KEY, ticket })).rejects.toMatchObject({ details: { reason: 'new-device' } });
    });

    it('with the new-device code off, signs in with the PIN on any device, and remembers it', async () => {
        settings({ emailSignIn: 'pin' });
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '604175', deviceKey: PHONE_KEY })).resolves.toEqual({ token: 'token-u1' });
        // Turning the setting on later asks no code on this device
        settings({ emailSignIn: 'pin', newDeviceCode: true });
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '604175', deviceKey: PHONE_KEY })).resolves.toEqual({ token: 'token-u1' });
    });

    it('locks on the fifth wrong PIN, the same lock as phone sign-in', async () => {
        settings({ emailSignIn: 'pin' });
        for (const remaining of [4, 3, 2, 1]) {
            await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '111111' })).rejects.toMatchObject({ details: { reason: 'wrong', remaining } });
        }
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '111111' })).rejects.toMatchObject({ details: { reason: 'locked' } });
        await expect(checkPin('u1', '604175')).resolves.toEqual({ ok: false, reason: 'locked' });
    });

    it('with the site on passwords, opens no email-and-PIN door to an account with a password; a PIN-only account keeps its PIN', async () => {
        settings({});
        person('p1', { password: true, email: 'pw@example.com' });
        await setPin('p1', '604175');
        await expect(call(pin.signInWithEmailPin, { email: 'pw@example.com', pin: '604175' })).rejects.toMatchObject({ details: { reason: 'pin-sign-in-off' } });
        await expect(call(pin.requestEmailPinCode, { email: 'pw@example.com', purpose: 'pin-reset' })).rejects.toMatchObject({ details: { reason: 'pin-sign-in-off' } });
        expect(mem.read(AUTH_PINS, 'p1')?.['failedAttempts']).toBe(0);
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '604175' })).resolves.toEqual({ token: 'token-u1' });
    });

    it('refuses an unknown address, a blocked account and a login another app owns', async () => {
        settings({ emailSignIn: 'pin' });
        await expect(call(pin.signInWithEmailPin, { email: 'nobody@example.com', pin: '604175' })).rejects.toMatchObject({ details: { reason: 'no-email-account' } });
        person('b1', { email: 'b@example.com' });
        mem.seed('users', 'rec-b1', { ...mem.read('users', 'rec-b1'), isActive: false });
        await expect(call(pin.signInWithEmailPin, { email: 'b@example.com', pin: '604175' })).rejects.toMatchObject({ details: { reason: 'account-blocked' } });
        person('h1', { email: 'h@example.com', authOwner: 'host' });
        await expect(call(pin.signInWithEmailPin, { email: 'h@example.com', pin: '604175' })).rejects.toMatchObject({ details: { reason: 'host-account' } });
    });
});

describe('Forgot PIN by email, and a first PIN', () => {
    it('sets a new PIN with a code, ends other sessions, forgets other devices and takes the password off', async () => {
        person('u1', { password: true });
        await setPin('u1', '604175');
        const { rememberDevice } = await import('../auth/devices.js');
        await rememberDevice('u1', OTHER_KEY);
        await call(pin.requestEmailPinCode, { email: EMAIL, purpose: 'pin-reset' });
        expect(lastTemplate()).toBe('pin_reset_otp_email');
        const { ticket } = await call(verifySignupOtp, { email: EMAIL, code: lastCode(), purpose: 'pin-reset' });
        await expect(call(pin.resetEmailPin, { email: EMAIL, pin: '135792', ticket, deviceKey: PHONE_KEY })).resolves.toEqual({ token: 'token-u1' });
        await expect(checkPin('u1', '135792')).resolves.toEqual({ ok: true });
        expect(owner.revokeRefreshTokens).toHaveBeenCalledWith('u1');
        expect(owner.updateUser).toHaveBeenCalledWith('u1', { providersToUnlink: ['password'] });
        expect(accounts['u1'].providerData).toEqual([]);
        // Only this device is known now
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '135792', deviceKey: OTHER_KEY })).rejects.toMatchObject({ details: { reason: 'new-device' } });
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '135792', deviceKey: PHONE_KEY })).resolves.toEqual({ token: 'token-u1' });
    });

    it('needs the ticket from verifying the code', async () => {
        person('u1');
        await call(pin.requestEmailPinCode, { email: EMAIL, purpose: 'pin-reset' });
        await call(verifySignupOtp, { email: EMAIL, code: lastCode(), purpose: 'pin-reset' });
        await expect(call(pin.resetEmailPin, { email: EMAIL, pin: '135792', ticket: 'guess' })).rejects.toMatchObject({ details: { reason: 'code-expired' } });
    });

    it('sends a device code only to an account with a PIN, and a PIN reset only where PINs are used', async () => {
        person('u1', { password: true });
        await expect(call(pin.requestEmailPinCode, { email: EMAIL, purpose: 'device' })).rejects.toMatchObject({ details: { reason: 'no-pin' } });
        settings({});
        await expect(call(pin.requestEmailPinCode, { email: EMAIL, purpose: 'pin-reset' })).rejects.toMatchObject({ details: { reason: 'pin-sign-in-off' } });
        expect(sent.emails).toHaveLength(0);
    });

    it('limits codes to 5 an hour per address', async () => {
        person('u1');
        for (let i = 0; i < 5; i++) {
            await call(pin.requestEmailPinCode, { email: EMAIL, purpose: 'pin-reset' });
            ageCode();
            mem.store.delete('signup_otps');
        }
        await expect(call(pin.requestEmailPinCode, { email: EMAIL, purpose: 'pin-reset' })).rejects.toMatchObject({ details: { reason: 'too-many-codes' } });
    });
});

describe('a password account moving to a PIN', () => {
    it('Forgot password says to use Forgot PIN while the site uses PINs; an admin keeps Forgot password', async () => {
        person('u1', { password: true });
        await expect(call(requestPasswordReset, { email: EMAIL })).rejects.toMatchObject({ details: { reason: 'pin-sign-in' } });
        person('a1', { password: true, role: 'admin', email: 'boss@example.com' });
        mem.seed('EmailTemplate', 't3', { type: 'password_reset_otp_email', subject: 'Reset', template: '##OTP##', isActive: true });
        await expect(call(requestPasswordReset, { email: 'boss@example.com' })).resolves.toMatchObject({ sent: true });
    });

    it('choosing a PIN while signed in takes the password off, and remembers this device', async () => {
        person('u1', { password: true });
        await expect(call(changePin, { pin: '604175', deviceKey: PHONE_KEY }, 'u1')).resolves.toEqual({ saved: true, passwordRemoved: true });
        expect(accounts['u1'].providerData).toEqual([]);
        await expect(call(pin.signInWithEmailPin, { email: EMAIL, pin: '604175', deviceKey: PHONE_KEY })).resolves.toEqual({ token: 'token-u1' });
    });

    it('keeps the password while the site uses passwords, and for an admin', async () => {
        settings({});
        person('u1', { password: true });
        await expect(call(changePin, { pin: '604175' }, 'u1')).resolves.toEqual({ saved: true });
        settings({ emailSignIn: 'pin' });
        person('a1', { password: true, role: 'admin', email: 'boss@example.com' });
        await expect(call(changePin, { pin: '604175' }, 'a1')).resolves.toEqual({ saved: true });
        expect(owner.updateUser).not.toHaveBeenCalled();
    });
});
