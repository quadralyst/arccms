import { describe, expect, it } from 'vitest';
import { DEFAULT_SMS_FORM, parseCountryCodes } from './sms-settings.service';

describe('SMS settings', () => {
    it('starts on the test provider, India only', () => {
        expect(DEFAULT_SMS_FORM).toMatchObject({ provider: 'log', defaultCountryCode: '91', allowedCountryCodes: '91' });
    });

    it('reads a typed list of country codes', () => {
        expect(parseCountryCodes('+91, 44 ,, x')).toEqual(['91', '44']);
        expect(parseCountryCodes('')).toEqual([]);
    });
});
