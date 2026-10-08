import { describe, expect, it } from 'vitest';
import {
    classifyIdentifier, cleanEmail, extractCode, formatPhone, hasCountryCode, identifierProblem, looksLikePhone,
    nationalNumber, normalizePhone, withoutTrunk,
} from './identifier.util';
import { countryByIso } from '../data/countries';
import { EMAIL_CASES, PHONE_CASES } from '../../../functions/src/__tests__/helpers/phoneCases';
import { normalizePhone as serverNormalizePhone } from '../../../functions/src/auth/phoneNumber';
import { cleanEmail as serverCleanEmail } from '../../../functions/src/auth/pastedText';

describe('normalizePhone (browser twin of the server)', () => {
    it.each(PHONE_CASES)('%s → %s', (raw, expected) => {
        expect(normalizePhone(raw)).toBe(expected);
    });

    it('agrees with the server on every case and on another country', () => {
        for (const [raw] of PHONE_CASES) expect(normalizePhone(raw)).toBe(serverNormalizePhone(raw));
        for (const raw of ['07700 900123', '447700900123', '+91 98765 43210']) {
            expect(normalizePhone(raw, '44')).toBe(serverNormalizePhone(raw, '44'));
        }
        for (const [raw, cc] of [['701 123 45 67', '7'], ['77011234567', '7'], ['415 555 2671', '1'], ['14155552671', '1']]) {
            expect(normalizePhone(raw, cc), raw).toBe(serverNormalizePhone(raw, cc));
        }
    });
});

describe('cleanEmail (browser twin of the server)', () => {
    it.each(EMAIL_CASES)('%s → %s', (raw, expected) => {
        expect(cleanEmail(raw)).toBe(expected);
        expect(serverCleanEmail(raw)).toBe(expected);
    });

    it('turns every pasted case into a usable email', () => {
        for (const [raw, expected] of EMAIL_CASES) {
            expect(classifyIdentifier(raw), raw).toEqual({ kind: 'email', value: expected, display: expected });
        }
    });
});

describe('identifierProblem: what to tell the person', () => {
    it.each([
        ['', true, 'empty'],
        ['   ', true, 'empty'],
        ['\u200B', true, 'empty'],
        ['asha@', true, 'email'],
        ['asha@example', true, 'email'],
        ['asha', true, 'not_phone_or_email'],
        ['asha', false, 'not_email'],
        ['---', true, 'not_phone_or_email'],
        ['9876543210', false, 'phone_off'],
        ['12345', false, 'phone_off'],
        ['1234567890', true, 'phone_start'],
        ['5876543210', true, 'phone_start'],
        ['+91 12345 67890', true, 'phone_start'],
        ['911234567890', true, 'phone_start'],
        ['98765', true, 'phone_short'],
        ['987654321', true, 'phone_short'],
        ['+91 98765', true, 'phone_short'],
        ['+44 77', true, 'phone_short'],
        ['98765432101', true, 'phone_long'],
        ['+91 98765 432101', true, 'phone_long'],
        ['+1234567890123456', true, 'phone_long'],
        ['+0 7700 900123', true, 'phone_country'],
    ] as const)('%j (phone on: %s) → %s', (raw, phoneOn, expected) => {
        expect(identifierProblem(raw, phoneOn)).toBe(expected);
    });

    it('has nothing to say about a good number or email', () => {
        expect(identifierProblem('98765 43210', true)).toBeNull();
        expect(identifierProblem('\u202A+44 7700 900123\u202C', true)).toBeNull();
        expect(identifierProblem('Asha <asha@example.com>', false)).toBeNull();
    });

    it('agrees with normalizePhone: no number it accepts gets a phone problem', () => {
        for (const [raw, expected] of PHONE_CASES) {
            if (expected) expect(identifierProblem(raw, true), raw).toBeNull();
            else if (raw && !/[a-z@]/i.test(raw)) expect(identifierProblem(raw, true), raw).toMatch(/^phone_/);
        }
    });
});

describe('classifyIdentifier', () => {
    it('cleans a pasted number and shows it without +91', () => {
        expect(classifyIdentifier('+91 98765-43210')).toEqual({ kind: 'phone', value: '+919876543210', display: '98765 43210' });
        expect(classifyIdentifier('(098765) 43210')).toMatchObject({ kind: 'phone', display: '98765 43210' });
    });

    it('shows a number from another country in full', () => {
        expect(classifyIdentifier('+44 7700 900123')).toMatchObject({ kind: 'phone', display: '+447700900123' });
    });

    it('cleans an email: spaces out, lower case', () => {
        expect(classifyIdentifier('  Asha.Rao@Example.COM ')).toEqual({ kind: 'email', value: 'asha.rao@example.com', display: 'asha.rao@example.com' });
    });

    it('marks anything else unknown', () => {
        expect(classifyIdentifier('12345').kind).toBe('unknown');
        expect(classifyIdentifier('asha@').kind).toBe('unknown');
        expect(classifyIdentifier('').kind).toBe('unknown');
    });
});

describe('formatPhone', () => {
    it('groups an Indian number as 5 and 5', () => {
        expect(formatPhone('+919876543210')).toBe('98765 43210');
    });

    it('shows every number in full on a site whose default country is not India', () => {
        expect(formatPhone('+447700900123', '44')).toBe('+447700900123');
        expect(formatPhone('+919876543210', '44')).toBe('+919876543210');
    });
});

describe('a site whose default country code is not 91 (Settings, SMS)', () => {
    it('reads a UK number typed the UK way, as the server does', () => {
        for (const raw of ['07700 900123', '7700 900123', '\u202A07700 900123\u202C', '+44 7700 900123']) {
            expect(classifyIdentifier(raw, '44'), raw).toEqual({ kind: 'phone', value: '+447700900123', display: '+447700900123' });
            expect(normalizePhone(raw, '44')).toBe(serverNormalizePhone(raw, '44'));
        }
    });

    it('still takes an Indian number given with +91', () => {
        expect(classifyIdentifier('+91 98765 43210', '44')).toMatchObject({ kind: 'phone', value: '+919876543210' });
    });

    it('never says Indian numbers start with 6 to 9 about a local number', () => {
        expect(identifierProblem('07700 9', true, '44')).toBe('phone_short');
        expect(identifierProblem('07700 900123 4567 89', true, '44')).toBe('phone_long');
        expect(identifierProblem('1234567890', true, '44')).toBeNull();
    });

    it('re-reads its own cleaned display the same way', () => {
        const id = classifyIdentifier('07700 900123', '44');
        expect(classifyIdentifier(id.display, '44').value).toBe(id.value);
    });
});

/** A number typed beside the country chip, the chip's country, and what is sent. */
const CHIP_CASES: Array<[string, string, string | null]> = [
    ['98765 43210', 'IN', '+919876543210'],
    ['098765 43210', 'IN', '+919876543210'],
    ['91 98765 43210', 'IN', '+919876543210'],
    ['7700 900123', 'GB', '+447700900123'],
    ['07700 900123', 'GB', '+447700900123'],
    ['(415) 555-2671', 'US', '+14155552671'],
    ['1 415 555 2671', 'US', '+14155552671'],
    ['(416) 555-0123', 'CA', '+14165550123'],
    ['8 912 345-67-89', 'RU', '+79123456789'],
    ['912 345 67 89', 'RU', '+79123456789'],
    ['8 701 123 45 67', 'KZ', '+77011234567'],
    ['8 029 123 45 67', 'BY', '+375291234567'],
    ['050 123 4567', 'AE', '+971501234567'],
    ['0412 345 678', 'AU', '+61412345678'],
    ['5876543210', 'IN', null],
    ['12', 'GB', null],
];

describe('a number typed beside the country chip (specs/phone-country-spec.md)', () => {
    it.each(CHIP_CASES)('%s in %s → %s', (typed, iso, expected) => {
        const country = countryByIso(iso)!;
        expect(normalizePhone(withoutTrunk(typed, country.trunk), country.code)).toBe(expected);
    });

    it('shows the chip from the first digit, +, or bracket, never for an email', () => {
        for (const text of ['9', '+', ' +44', '(0', '\u202A98']) expect(looksLikePhone(text), text).toBe(true);
        for (const text of ['', 'a', 'asha@example.com', '@', '-']) expect(looksLikePhone(text), text).toBe(false);
    });

    it('knows when a number brings its own country code', () => {
        expect(hasCountryCode('+44 7700 900123')).toBe(true);
        expect(hasCountryCode('0044 7700 900123')).toBe(true);
        expect(hasCountryCode('07700 900123')).toBe(false);
    });

    it('leaves a number with its own code, and a short one, alone', () => {
        expect(withoutTrunk('+7 912 345 67 89', '8')).toBe('+7 912 345 67 89');
        expect(withoutTrunk('8912345678', '8')).toBe('8912345678');
        expect(withoutTrunk('07700 900123')).toBe('07700 900123');
    });

    it('shows the number without its code', () => {
        expect(nationalNumber('+919876543210', '91')).toBe('98765 43210');
        expect(nationalNumber('+447700900123', '44')).toBe('7700900123');
        expect(nationalNumber('+447700900123', '91')).toBe('+447700900123');
    });

    it('turns down a number from a country the site does not take', () => {
        expect(identifierProblem('+44 7700 900123', true, '91', ['91'])).toBe('phone_not_allowed');
        expect(identifierProblem('+44 7700 900123', true, '91', ['91', '44'])).toBeNull();
        expect(identifierProblem('98765 43210', true, '91', ['91'])).toBeNull();
        expect(identifierProblem('+44 7700 900123', true, '91')).toBeNull();
    });
});

describe('extractCode', () => {
    it.each([
        ['482913', '482913'],
        ['Your code is 482913.', '482913'],
        ['482 913', '482913'],
        ['482-913 is your verification code', '482913'],
        ['12345', null],
        ['1234567', null],
        ['', null],
    ])('%s → %s', (text, expected) => {
        expect(extractCode(text)).toBe(expected);
    });
});
