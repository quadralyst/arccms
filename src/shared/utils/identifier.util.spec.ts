import { describe, expect, it } from 'vitest';
import { classifyIdentifier, extractCode, formatPhone, normalizePhone } from './identifier.util';
import { PHONE_CASES } from '../../../functions/src/__tests__/helpers/phoneCases';
import { normalizePhone as serverNormalizePhone } from '../../../functions/src/auth/phoneNumber';

describe('normalizePhone (browser twin of the server)', () => {
    it.each(PHONE_CASES)('%s → %s', (raw, expected) => {
        expect(normalizePhone(raw)).toBe(expected);
    });

    it('agrees with the server on every case and on another country', () => {
        for (const [raw] of PHONE_CASES) expect(normalizePhone(raw)).toBe(serverNormalizePhone(raw));
        for (const raw of ['07700 900123', '447700900123', '+91 98765 43210']) {
            expect(normalizePhone(raw, '44')).toBe(serverNormalizePhone(raw, '44'));
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
