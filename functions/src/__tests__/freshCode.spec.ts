/**
 * A fresh code before a sensitive action (F31 part 2, docs/app/fresh-code.html), on an
 * in-memory Firestore with the real email and SMS code stores: only the send itself
 * (queueEmail, sendSms) is replaced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner: {} };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string, public details?: unknown) { super(message); }
    },
    onCall: vi.fn((handler: unknown) => handler),
}));
const sent = vi.hoisted(() => ({ emails: [] as Array<Record<string, any>>, sms: [] as Array<Record<string, any>>, emailStatus: 'pending', smsStatus: 'sent' }));
vi.mock('../email-core/queueEmail', () => ({
    queueEmail: vi.fn(async (input: Record<string, unknown>) => { sent.emails.push(input); return { id: 'log', status: sent.emailStatus }; }),
}));
vi.mock('../email-core/defaultTemplates', () => ({ ensureDefaultTemplates: vi.fn(async () => ({ created: [], skipped: [] })) }));
vi.mock('../email-core/appEmailTemplates', () => ({ accountEmailInLanguage: vi.fn(async () => null) }));
vi.mock('../sms/sendSms', () => ({
    sendSms: vi.fn(async (message: Record<string, unknown>) => { sent.sms.push(message); return { status: sent.smsStatus }; }),
}));
const sms = vi.hoisted(() => ({ settings: { provider: 'twilio', showResetCodes: false, defaultCountryCode: '91', allowedCountryCodes: [] } as Record<string, unknown> }));
vi.mock('../sms/smsSettings', () => ({ readSmsSettings: vi.fn(async () => sms.settings) }));

import { db } from '../init.js';
import { FRESH_PROOFS, confirmFreshCode, freshCodeTarget, maskEmail, requestFreshCode, useFreshCodeProof } from '../auth/freshCode.js';
import { useFreshCodeProof as fromKit } from '../app-kit/index.js';

const mem = db as unknown as {
    store: Map<string, Map<string, Record<string, unknown>>>;
    all(c: string): Array<{ id: string; data: Record<string, unknown> }>;
    seed(c: string, id: string, data: Record<string, unknown>): void;
};
type Call = (request: unknown) => Promise<any>;
const request = requestFreshCode as unknown as Call;
const confirm = confirmFreshCode as unknown as Call;

const as = (uid: string, data: Record<string, unknown> = {}) => ({ auth: { uid, token: {} }, data, rawRequest: { ip: '203.0.113.9', headers: {} } }) as never;
const emailCode = () => String(sent.emails.at(-1)?.data?.otp);
const smsCode = () => String(sent.sms.at(-1)?.code);

function person(uid: string, data: Record<string, unknown>) {
    mem.seed('users', `rec-${uid}`, { uid, name: 'Asha', isActive: true, status: 'Active', email: '', phone: '', ...data });
}

beforeEach(() => {
    mem.store.clear();
    sent.emails = [];
    sent.sms = [];
    sent.emailStatus = 'pending';
    sent.smsStatus = 'sent';
    sms.settings = { provider: 'twilio', showResetCodes: false, defaultCountryCode: '91', allowedCountryCodes: [] };
    mem.seed('EmailTemplate', 't1', { type: 'signup_otp_email', subject: 'Your verification code', template: '##OTP##', isActive: true });
});

describe('where the code goes', () => {
    it('to a verified address first, then a verified number, then any address, else nowhere', () => {
        expect(freshCodeTarget({ email: 'A@x.com', emailVerified: true, phone: '+911', phoneVerified: true })).toEqual({ via: 'email', email: 'a@x.com' });
        expect(freshCodeTarget({ email: 'a@x.com', emailVerified: false, phone: '+911', phoneVerified: true })).toEqual({ via: 'phone', phone: '+911' });
        expect(freshCodeTarget({ email: 'a@x.com', emailVerified: false, phone: '' })).toEqual({ via: 'email', email: 'a@x.com' });
        expect(freshCodeTarget({ email: '', phone: '' })).toBeNull();
        expect(maskEmail('asha@example.com')).toBe('a•••@example.com');
    });
});

describe('requestFreshCode and confirmFreshCode', () => {
    it('emails a code to the person\'s own address, and its confirmation gives a proof the app uses up once', async () => {
        person('u1', { email: 'asha@example.com', emailVerified: true });
        await expect(request(as('u1', { purpose: 'pos-setup' }))).resolves.toMatchObject({ sent: true, via: 'email', to: 'a•••@example.com' });
        expect(sent.emails[0]).toMatchObject({ toEmail: 'asha@example.com', type: 'signup_otp_email' });

        const { proof } = await confirm(as('u1', { purpose: 'pos-setup', code: emailCode() }));
        expect(typeof proof).toBe('string');
        expect(fromKit).toBe(useFreshCodeProof);
        await expect(useFreshCodeProof(as('u1'), proof, 'pos-setup')).resolves.toBeUndefined();
        // One use only
        await expect(useFreshCodeProof(as('u1'), proof, 'pos-setup')).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'fresh-code-required' } });
    });

    it('sends an SMS to a person with only a verified number', async () => {
        person('u2', { phone: '+919812345678', phoneVerified: true });
        await expect(request(as('u2', { purpose: 'export' }))).resolves.toMatchObject({ sent: true, via: 'phone' });
        expect(sent.sms[0]).toMatchObject({ to: '+919812345678' });
        const { proof } = await confirm(as('u2', { purpose: 'export', code: smsCode() }));
        await expect(useFreshCodeProof(as('u2'), proof, 'export')).resolves.toBeUndefined();
    });

    it('refuses a proof for another purpose, another person, or past its 5 minutes', async () => {
        person('u1', { email: 'asha@example.com', emailVerified: true });
        await request(as('u1', { purpose: 'pos-setup' }));
        const { proof } = await confirm(as('u1', { purpose: 'pos-setup', code: emailCode() }));
        await expect(useFreshCodeProof(as('u1'), proof, 'export')).rejects.toMatchObject({ details: { reason: 'fresh-code-required' } });
        await expect(useFreshCodeProof(as('u9'), proof, 'pos-setup')).rejects.toMatchObject({ details: { reason: 'fresh-code-required' } });
        await expect(useFreshCodeProof(as('u1'), 'not-the-proof', 'pos-setup')).rejects.toMatchObject({ details: { reason: 'fresh-code-required' } });
        await expect(useFreshCodeProof(as('u1'), undefined, 'pos-setup')).rejects.toMatchObject({ details: { reason: 'fresh-code-required' } });

        const [{ id }] = mem.all(FRESH_PROOFS);
        mem.seed(FRESH_PROOFS, id, { ...mem.all(FRESH_PROOFS)[0].data, expiresAt: { toMillis: () => Date.now() - 1 } });
        await expect(useFreshCodeProof(as('u1'), proof, 'pos-setup')).rejects.toMatchObject({ details: { reason: 'fresh-code-required' } });
        // An expired proof is cleared, not left behind
        expect(mem.all(FRESH_PROOFS)).toEqual([]);
    });

    it('a wrong code costs a try and gives no proof; the code is for the account that asked', async () => {
        person('u1', { email: 'asha@example.com', emailVerified: true });
        await request(as('u1', { purpose: 'pos-setup' }));
        const wrong = emailCode() === '111111' ? '222222' : '111111';
        await expect(confirm(as('u1', { purpose: 'pos-setup', code: wrong }))).rejects.toMatchObject({ details: { reason: 'code-wrong' } });
        await expect(confirm(as('u1', { purpose: 'pos-setup', code: '12' }))).rejects.toMatchObject({ details: { reason: 'code-wrong' } });
        expect(mem.all(FRESH_PROOFS)).toEqual([]);
        // Another account sharing nothing cannot use it
        person('u3', { email: 'asha@example.com', emailVerified: true });
        await expect(confirm(as('u3', { purpose: 'pos-setup', code: emailCode() }))).rejects.toMatchObject({ details: { reason: 'code-expired' } });
    });

    it('asked again within the minute sends nothing new', async () => {
        person('u1', { email: 'asha@example.com', emailVerified: true });
        await request(as('u1', { purpose: 'pos-setup' }));
        await expect(request(as('u1', { purpose: 'pos-setup' }))).resolves.toMatchObject({ sent: true, alreadySent: true, wait: expect.any(Number) });
        expect(sent.emails).toHaveLength(1);
    });

    it('stops at 5 codes an hour for the person', async () => {
        person('u1', { email: 'asha@example.com', emailVerified: true });
        const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            for (let i = 0; i < 5; i++) {
                await request(as('u1', { purpose: 'pos-setup' }));
                later(61_000);
            }
            await expect(request(as('u1', { purpose: 'pos-setup' }))).rejects.toMatchObject({ code: 'resource-exhausted', details: { reason: 'too-many-codes' } });
        } finally {
            vi.useRealTimers();
        }
    });

    it('gives the counts back and says so when the email could not be sent', async () => {
        person('u1', { email: 'asha@example.com', emailVerified: true });
        sent.emailStatus = 'skipped';
        await expect(request(as('u1', { purpose: 'pos-setup' }))).rejects.toMatchObject({ details: { reason: 'email-failed' } });
        expect(mem.all('_rate_limits').every((l) => l.data['count'] === 0)).toBe(true);
    });

    it('shows the code on screen while testing only when an admin allows reset codes on screen', async () => {
        person('u2', { phone: '+919812345678', phoneVerified: true });
        sms.settings = { ...sms.settings, provider: 'log', showResetCodes: false };
        sent.smsStatus = 'logged';
        const hidden = await request(as('u2', { purpose: 'export' }));
        expect(hidden).toMatchObject({ testMode: true, testCodeInLogs: true });
        expect(hidden.testCode).toBeUndefined();
        mem.store.delete('phone_otps');
        sms.settings = { ...sms.settings, showResetCodes: true };
        await expect(request(as('u2', { purpose: 'export' }))).resolves.toMatchObject({ testMode: true, testCode: expect.stringMatching(/^\d{6}$/) });
    });

    it('refuses a bad purpose, an account with nowhere to send, a blocked account and a visitor', async () => {
        person('u1', { email: 'asha@example.com', emailVerified: true });
        person('none', {});
        person('blocked', { email: 'b@example.com', emailVerified: true, isActive: false });
        await expect(request(as('u1', { purpose: 'Pos Setup' }))).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(request(as('u1', { purpose: 'a__b' }))).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(request(as('none', { purpose: 'export' }))).rejects.toMatchObject({ details: { reason: 'no-contact' } });
        await expect(request(as('blocked', { purpose: 'export' }))).rejects.toMatchObject({ details: { reason: 'account-blocked' } });
        await expect(request({ data: { purpose: 'export' } })).rejects.toMatchObject({ code: 'unauthenticated' });
        await expect(useFreshCodeProof({ auth: undefined }, 'x', 'export')).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(sent.emails).toHaveLength(0);
    });
});
