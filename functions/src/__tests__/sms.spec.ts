/**
 * SMS layer: settings defaults, the MSG91 request, and what `sendSms` logs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore');
    return { db: new MemoryFirestore(), owner: {} };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { db } from '../init.js';
import { resolveSmsSettings, DEFAULT_SMS_SETTINGS } from '../sms/smsSettings.js';
import { buildMsg91OtpRequest } from '../sms/providers.js';
import { loggedText, sendSms } from '../sms/sendSms.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;

describe('resolveSmsSettings', () => {
    it('defaults to the log provider and +91 only', () => {
        expect(resolveSmsSettings(undefined)).toEqual(DEFAULT_SMS_SETTINGS);
        expect(DEFAULT_SMS_SETTINGS.provider).toBe('log');
        expect(DEFAULT_SMS_SETTINGS.allowedCountryCodes).toEqual(['91']);
    });

    it('keeps digits only in country codes and ignores an unknown provider', () => {
        const settings = resolveSmsSettings({ provider: 'carrier-pigeon', defaultCountryCode: '+44', allowedCountryCodes: ['+91', ' 44 ', ''] });
        expect(settings.provider).toBe('log');
        expect(settings.defaultCountryCode).toBe('44');
        expect(settings.allowedCountryCodes).toEqual(['91', '44']);
    });
});

describe('buildMsg91OtpRequest', () => {
    it('sends the number without +, the template and the code, with the auth key header', () => {
        const { url, init } = buildMsg91OtpRequest(
            { to: '+919876543210', purpose: 'otp', text: '', code: '482913' },
            { ...DEFAULT_SMS_SETTINGS, provider: 'msg91', msg91AuthKey: 'KEY', msg91OtpTemplateId: 'TPL' },
        );
        const parsed = new URL(url);
        expect(parsed.origin + parsed.pathname).toBe('https://control.msg91.com/api/v5/otp');
        expect(parsed.searchParams.get('mobile')).toBe('919876543210');
        expect(parsed.searchParams.get('template_id')).toBe('TPL');
        expect(parsed.searchParams.get('otp')).toBe('482913');
        expect((init.headers as Record<string, string>)['authkey']).toBe('KEY');
        expect(init.method).toBe('POST');
    });
});

describe('sendSms', () => {
    beforeEach(() => mem.store.clear());

    it('log provider: sends nothing and keeps the full text, code included', async () => {
        const result = await sendSms({ to: '+919876543210', purpose: 'otp', code: '123456', text: '123456 is your code' });
        expect(result.status).toBe('logged');
        const [log] = mem.all('SmsLogs');
        expect(log.data).toMatchObject({ to: '+919876543210', provider: 'log', status: 'logged', text: '123456 is your code' });
    });

    it('msg91 without credentials: fails, logs the error, and never stores the code', async () => {
        const result = await sendSms(
            { to: '+919876543210', purpose: 'otp', code: '123456', text: '123456 is your code' },
            { ...DEFAULT_SMS_SETTINGS, provider: 'msg91' },
        );
        expect(result.status).toBe('failed');
        const [log] = mem.all('SmsLogs');
        expect(log.data['status']).toBe('failed');
        expect(String(log.data['error'])).toMatch(/auth key/);
        expect(log.data['text']).toBe('•••••• is your code');
    });

    it('loggedText blanks the code only when asked to', () => {
        const msg = { to: '+91', purpose: 'otp' as const, code: '111222', text: 'Code 111222.' };
        expect(loggedText(msg, true)).toBe('Code 111222.');
        expect(loggedText(msg, false)).toBe('Code ••••••.');
    });
});
