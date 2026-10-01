import { describe, expect, it } from 'vitest';
import { DEFAULT_SMS_FORM, parseCountryCodes, smsSettingsData } from './sms-settings.service';

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
