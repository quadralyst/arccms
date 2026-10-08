import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { DEFAULT_SMS_FORM, parseCountryCodes, SmsSettingsService, smsSettingsData } from './sms-settings.service';

// Firestore stand-in: records every write, and serves `docs` to getDoc.
const fs = vi.hoisted(() => {
    const writes: Array<[string, Record<string, unknown>]> = [];
    const docs: Record<string, Record<string, unknown> | undefined> = {};
    return {
        writes,
        docs,
        doc: (_db: unknown, _c: string, id: string) => id,
        getDoc: async (id: string) => ({ exists: () => docs[id] !== undefined, data: () => docs[id] }),
        setDoc: async (id: string, data: Record<string, unknown>) => { writes.push([id, data]); },
        writeBatch: () => {
            const batched: Array<[string, Record<string, unknown>]> = [];
            return {
                set(id: string, data: Record<string, unknown>) { batched.push([id, data]); },
                async commit() { writes.push(...batched); },
            };
        },
    };
});
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class Firestore {},
    doc: fs.doc,
    getDoc: fs.getDoc,
    setDoc: fs.setDoc,
    writeBatch: fs.writeBatch,
    serverTimestamp: () => 'now',
}));
vi.mock('@angular/fire/functions', () => ({ Functions: class Functions {} }));

describe('SMS settings', () => {
    it('starts on the test provider, India only', () => {
        expect(DEFAULT_SMS_FORM).toMatchObject({ provider: 'log', defaultCountryCode: '91', allowedCountryCodes: '91' });
    });

    it('reads a typed list of country codes', () => {
        expect(parseCountryCodes('+91, 44 ,, x')).toEqual(['91', '44']);
        expect(parseCountryCodes('')).toEqual([]);
    });

    it('keeps PIN reset codes off screen unless switched on, and only in test mode', () => {
        expect(DEFAULT_SMS_FORM.showResetCodes).toBe(false);
        expect(smsSettingsData({ ...DEFAULT_SMS_FORM, showResetCodes: true })['showResetCodes']).toBe(true);
        expect(smsSettingsData({ ...DEFAULT_SMS_FORM, provider: 'msg91', showResetCodes: true })['showResetCodes']).toBe(false);
    });

    it('keeps the saved MSG91 key when the field is left empty', () => {
        expect(smsSettingsData(DEFAULT_SMS_FORM)).not.toHaveProperty('msg91AuthKey');
        expect(smsSettingsData({ ...DEFAULT_SMS_FORM, msg91AuthKey: ' k ' })['msg91AuthKey']).toBe('k');
    });
});

describe('SmsSettingsService: the sign-in page\'s copy of the default country code', () => {
    let service: SmsSettingsService;
    beforeEach(() => {
        fs.writes.length = 0;
        for (const key of Object.keys(fs.docs)) delete fs.docs[key];
        TestBed.configureTestingModule({
            providers: [{ provide: Firestore, useValue: {} }, { provide: Functions, useValue: {} }],
        });
        service = TestBed.inject(SmsSettingsService);
    });

    it('saves the default country code to Settings/users in the same write', async () => {
        await service.save({ ...DEFAULT_SMS_FORM, defaultCountryCode: '+44' });
        expect(fs.writes.map(([id]) => id)).toEqual(['sms', 'users']);
        expect(fs.writes[0][1]).toMatchObject({ defaultCountryCode: '44' });
        expect(fs.writes[1][1]).toEqual({ phoneCountryCode: '44' });
    });

    it('repairs a missing or stale copy when the page opens', async () => {
        fs.docs['sms'] = { defaultCountryCode: '44' };
        fs.docs['users'] = { phoneSignIn: true };
        await service.load();
        expect(fs.writes).toEqual([['users', { phoneCountryCode: '44' }]]);
    });

    it('leaves a copy that is in step, and a site with no SMS settings, alone', async () => {
        fs.docs['sms'] = { defaultCountryCode: '44' };
        fs.docs['users'] = { phoneCountryCode: '44' };
        await service.load();
        delete fs.docs['sms'];
        fs.docs['users'] = {};
        await service.load();
        expect(fs.writes).toEqual([]);
    });
});
