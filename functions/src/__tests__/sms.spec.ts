/**
 * SMS layer: settings defaults, the MSG91 request, and what `sendSms` logs.
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
const notifyAdmins = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../email-core/adminAlerts', () => ({ notifyAdmins }));

import { db } from '../init.js';
import { resolveSmsSettings, DEFAULT_SMS_SETTINGS } from '../sms/smsSettings.js';
import { countDailySms, siteDate, SMS_DAILY } from '../sms/smsDailyLimit.js';
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

    it('reads an emptied country list as the default country only, never everywhere (review F)', () => {
        expect(resolveSmsSettings({ defaultCountryCode: '44', allowedCountryCodes: [] }).allowedCountryCodes).toEqual(['44']);
        expect(resolveSmsSettings({ allowedCountryCodes: ['', ' '] }).allowedCountryCodes).toEqual(['91']);
    });
});

describe('showResetCodes', () => {
    it('is off unless an admin saved it as true', () => {
        expect(resolveSmsSettings(undefined).showResetCodes).toBe(false);
        expect(resolveSmsSettings({ showResetCodes: 'yes' }).showResetCodes).toBe(false);
        expect(resolveSmsSettings({ showResetCodes: true }).showResetCodes).toBe(true);
    });
});

describe('dailyLimit', () => {
    it('is 300 a day unless an admin saved a whole number from 1 up', () => {
        expect(resolveSmsSettings(undefined).dailyLimit).toBe(300);
        expect(resolveSmsSettings({ dailyLimit: 50 }).dailyLimit).toBe(50);
        expect(resolveSmsSettings({ dailyLimit: '75' }).dailyLimit).toBe(75);
        for (const bad of [0, -5, 2.5, 'lots', null, 1e9]) expect(resolveSmsSettings({ dailyLimit: bad }).dailyLimit).toBe(300);
    });
});

describe('the daily limit on texts', () => {
    const msg91 = { ...DEFAULT_SMS_SETTINGS, provider: 'msg91' as const, msg91AuthKey: 'KEY', msg91OtpTemplateId: 'TPL', dailyLimit: 2 };
    const text = { to: '+919876543210', purpose: 'otp' as const, code: '123456', text: '123456 is your code' };
    const fetchMock = vi.fn();

    beforeEach(() => {
        mem.store.clear();
        notifyAdmins.mockClear();
        fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ type: 'success', request_id: 'r1' }), text: async () => '' });
        vi.stubGlobal('fetch', fetchMock);
    });

    it('a day is the site\'s, in its time zone', () => {
        const at = new Date(Date.UTC(2026, 10, 10, 20, 0));
        expect(siteDate(at, 'UTC')).toBe('2026-11-10');
        expect(siteDate(at, 'Asia/Kolkata')).toBe('2026-11-11');
    });

    it('sends up to the limit, then logs the rest as limited, sends nothing and tells the admins once', async () => {
        expect((await sendSms(text, msg91)).status).toBe('sent');
        expect((await sendSms(text, msg91)).status).toBe('sent');
        const third = await sendSms(text, msg91);
        expect(third.status).toBe('limited');
        await sendSms(text, msg91);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(notifyAdmins).toHaveBeenCalledTimes(1);
        expect(notifyAdmins).toHaveBeenCalledWith('admin_sms_limit', expect.objectContaining({ link: '/admin/settings/sms' }));
        const logs = mem.all('SmsLogs').map((l) => l.data['status']);
        expect(logs).toEqual(['sent', 'sent', 'limited', 'limited']);
        const [day] = mem.all(SMS_DAILY);
        expect(day.data).toMatchObject({ count: 2, alerted: true });
    });

    it('gives back a text the provider refused, and never counts the Test provider', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ type: 'error', message: 'down' }), text: async () => 'down' });
        expect((await sendSms(text, msg91)).status).toBe('failed');
        await sendSms(text, { ...DEFAULT_SMS_SETTINGS, dailyLimit: 1 });
        expect(Number(mem.all(SMS_DAILY)[0]?.data['count'] ?? 0)).toBe(0);
    });

    it('counts in one document a day, in a transaction', async () => {
        await expect(countDailySms(1)).resolves.toMatchObject({ ok: true });
        await expect(countDailySms(1)).resolves.toEqual({ ok: false });
        expect(mem.all(SMS_DAILY)).toHaveLength(1);
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
