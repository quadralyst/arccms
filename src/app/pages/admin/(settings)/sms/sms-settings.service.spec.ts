import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { DEFAULT_SMS_FORM, publicCountryCopy, SmsSettingsService, smsSettingsData } from './sms-settings.service';

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
        expect(DEFAULT_SMS_FORM).toMatchObject({ provider: 'log', defaultCountry: 'IN', allowedCountries: ['IN'] });
    });

    it('saves the countries and their codes, which the server reads', () => {
        expect(smsSettingsData({ ...DEFAULT_SMS_FORM, defaultCountry: 'CA', allowedCountries: ['IN', 'US', 'CA'] })).toMatchObject({
            defaultCountry: 'CA',
            allowedCountries: ['IN', 'US', 'CA'],
            defaultCountryCode: '1',
            allowedCountryCodes: ['91', '1'],
        });
    });

    it('never saves an empty list, or a default outside the list', () => {
        expect(smsSettingsData({ ...DEFAULT_SMS_FORM, defaultCountry: 'GB', allowedCountries: [] })).toMatchObject({
            defaultCountry: 'GB', allowedCountries: ['GB'], defaultCountryCode: '44', allowedCountryCodes: ['44'],
        });
        expect(smsSettingsData({ ...DEFAULT_SMS_FORM, defaultCountry: 'GB', allowedCountries: ['IN', 'AE'] })).toMatchObject({
            defaultCountry: 'IN', defaultCountryCode: '91',
        });
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

describe('SmsSettingsService: the sign-in page\'s copy of the countries', () => {
    let service: SmsSettingsService;
    beforeEach(() => {
        fs.writes.length = 0;
        for (const key of Object.keys(fs.docs)) delete fs.docs[key];
        TestBed.configureTestingModule({
            providers: [{ provide: Firestore, useValue: {} }, { provide: Functions, useValue: {} }],
        });
        service = TestBed.inject(SmsSettingsService);
    });

    it('saves the countries to Settings/users in the same write', async () => {
        await service.save({ ...DEFAULT_SMS_FORM, defaultCountry: 'GB', allowedCountries: ['IN', 'GB'] });
        expect(fs.writes.map(([id]) => id)).toEqual(['sms', 'users']);
        expect(fs.writes[0][1]).toMatchObject({ defaultCountry: 'GB', defaultCountryCode: '44', allowedCountryCodes: ['91', '44'] });
        expect(fs.writes[1][1]).toEqual({ phoneCountry: 'GB', phoneCountryCode: '44', phoneCountries: ['IN', 'GB'] });
    });

    it('reads an install saved before countries were: each code\'s main country', async () => {
        fs.docs['sms'] = { defaultCountryCode: '44', allowedCountryCodes: ['91', '44', '1'] };
        fs.docs['users'] = { phoneSignIn: true, phoneCountryCode: '44' };
        const { form } = await service.load();
        expect(form).toMatchObject({ defaultCountry: 'GB', allowedCountries: ['IN', 'GB', 'US'] });
        expect(fs.writes).toEqual([['users', { phoneCountry: 'GB', phoneCountryCode: '44', phoneCountries: ['IN', 'GB', 'US'] }]]);
    });

    it('repairs a missing or stale copy when the page opens', async () => {
        fs.docs['sms'] = { defaultCountry: 'AE', allowedCountries: ['AE', 'IN'], defaultCountryCode: '971', allowedCountryCodes: ['971', '91'] };
        fs.docs['users'] = { phoneSignIn: true, phoneCountryCode: '971', phoneCountries: ['AE'] };
        await service.load();
        expect(fs.writes).toEqual([['users', { phoneCountry: 'AE', phoneCountryCode: '971', phoneCountries: ['AE', 'IN'] }]]);
    });

    it('leaves a copy that is in step, and a site with no SMS settings, alone', async () => {
        fs.docs['sms'] = { defaultCountry: 'GB', allowedCountries: ['GB'] };
        fs.docs['users'] = publicCountryCopy({ country: 'GB', countries: ['GB'] });
        await service.load();
        delete fs.docs['sms'];
        fs.docs['users'] = {};
        const { form } = await service.load();
        expect(fs.writes).toEqual([]);
        expect(form).toMatchObject({ defaultCountry: 'IN', allowedCountries: ['IN'] });
    });
});
