import { describe, expect, it } from 'vitest';
import { isAllowedCountry, maskPhone, normalizePhone, phoneHash } from '../auth/phoneNumber.js';
import { cleanEmail } from '../auth/pastedText.js';
import { EMAIL_CASES, PHONE_CASES } from './helpers/phoneCases.js';

describe('normalizePhone', () => {
    it.each(PHONE_CASES)('%s → %s', (raw, expected) => {
        expect(normalizePhone(raw)).toBe(expected);
    });

    it('reads national numbers against another default country', () => {
        expect(normalizePhone('07700 900123', '44')).toBe('+447700900123');
        expect(normalizePhone('447700900123', '44')).toBe('+447700900123');
    });

    it('under +1 and +7 takes the code as given only with all eleven digits (Kazakh numbers start with 7)', () => {
        expect(normalizePhone('701 123 45 67', '7')).toBe('+77011234567');
        expect(normalizePhone('7 701 123 45 67', '7')).toBe('+77011234567');
        expect(normalizePhone('912 345 67 89', '7')).toBe('+79123456789');
        expect(normalizePhone('415 555 2671', '1')).toBe('+14155552671');
        expect(normalizePhone('1 415 555 2671', '1')).toBe('+14155552671');
    });
});

describe('cleanEmail', () => {
    it.each(EMAIL_CASES)('%s → %s', (raw, expected) => {
        expect(cleanEmail(raw)).toBe(expected);
    });
});

describe('isAllowedCountry', () => {
    it('allows only the listed codes', () => {
        expect(isAllowedCountry('+919876543210', ['91'])).toBe(true);
        expect(isAllowedCountry('+447700900123', ['91'])).toBe(false);
        expect(isAllowedCountry('+447700900123', ['91', '44'])).toBe(true);
    });

    it('allows nothing with an empty list, never everywhere (review F)', () => {
        expect(isAllowedCountry('+447700900123', [])).toBe(false);
    });
});

describe('phoneHash and maskPhone', () => {
    it('hashes the E.164 form', () => {
        expect(phoneHash('+919876543210')).toMatch(/^[a-f0-9]{64}$/);
        expect(phoneHash('+919876543210')).not.toBe(phoneHash('+919876543211'));
    });

    it('shows only the country code and the last five digits', () => {
        expect(maskPhone('+919876543210')).toBe('+91 ••••• 43210');
    });
});
