import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    cleanCountryList, codesOf, COUNTRIES, countriesForCode, countriesFromCodes, countryByIso,
    countryForE164, countryName, DEFAULT_COUNTRY, flagUrl, resolveCountrySettings,
} from './countries';

const FLAGS = resolve(__dirname, '../../../public/flags/4x3');

describe('the country table', () => {
    it('has each country once, with a digits-only code', () => {
        expect(new Set(COUNTRIES.map((c) => c.iso)).size).toBe(COUNTRIES.length);
        for (const c of COUNTRIES) {
            expect(c.iso, c.iso).toMatch(/^[A-Z]{2}$/);
            expect(c.code, c.iso).toMatch(/^[1-9]\d{0,2}$/);
        }
        expect(countryByIso(DEFAULT_COUNTRY)?.code).toBe('91');
    });

    it('marks exactly one main country for every shared code', () => {
        const codes = new Set(COUNTRIES.map((c) => c.code));
        for (const code of codes) {
            const users = COUNTRIES.filter((c) => c.code === code);
            if (users.length > 1) expect(users.filter((c) => c.primary).map((c) => c.iso), `+${code}`).toHaveLength(1);
        }
        expect(countriesForCode('1')[0].iso).toBe('US');
        expect(countriesForCode('+7')[0].iso).toBe('RU');
        expect(countriesForCode('44')[0].iso).toBe('GB');
    });

    it('has a flag for every country, no flag without a country, and the flags licence', () => {
        const files = readdirSync(FLAGS).sort();
        expect(files).toEqual(COUNTRIES.map((c) => `${c.iso.toLowerCase()}.svg`).sort());
        expect(existsSync(resolve(FLAGS, '../LICENSE'))).toBe(true);
        expect(flagUrl('IN')).toBe('/flags/4x3/in.svg');
    });
});

describe('stored lists', () => {
    it('cleans a stored country list', () => {
        expect(cleanCountryList(['in', 'XX', 'IN', 5, ' gb '])).toEqual(['IN', 'GB']);
        expect(cleanCountryList('IN')).toEqual([]);
    });

    it('turns an old install\'s codes into their main countries', () => {
        expect(countriesFromCodes(['91', '44', '+1', '999', '44'])).toEqual(['IN', 'GB', 'US']);
    });

    it('turns countries into codes, once each', () => {
        expect(codesOf(['US', 'CA', 'IN', 'ZZ'])).toEqual(['1', '91']);
    });
});

describe('resolveCountrySettings', () => {
    it('takes stored countries first', () => {
        expect(resolveCountrySettings({ countries: ['GB', 'IN'], codes: ['1'], country: 'IN', code: '1' })).toEqual({ country: 'IN', countries: ['GB', 'IN'] });
    });

    it('reads an old install\'s codes', () => {
        expect(resolveCountrySettings({ codes: ['91', '44'], code: '44' })).toEqual({ country: 'GB', countries: ['IN', 'GB'] });
    });

    it('is India with nothing stored, and the default alone with no list', () => {
        expect(resolveCountrySettings({})).toEqual({ country: 'IN', countries: ['IN'] });
        expect(resolveCountrySettings({ code: '971' })).toEqual({ country: 'AE', countries: ['AE'] });
    });

    it('never widens the list for a default outside it', () => {
        expect(resolveCountrySettings({ countries: ['IN', 'AE'], country: 'GB' })).toEqual({ country: 'IN', countries: ['IN', 'AE'] });
    });
});

describe('countryForE164', () => {
    it('finds the allowed country a number belongs to', () => {
        expect(countryForE164('+447700900123', ['IN', 'GB'])?.iso).toBe('GB');
        expect(countryForE164('+919876543210', ['IN', 'GB'])?.iso).toBe('IN');
        expect(countryForE164('+447700900123', ['IN'])).toBeNull();
    });

    it('keeps the chosen country when the code is shared, else the main one', () => {
        expect(countryForE164('+14165550123', ['US', 'CA'], 'CA')?.iso).toBe('CA');
        expect(countryForE164('+14165550123', ['US', 'CA'], 'IN')?.iso).toBe('US');
        expect(countryForE164('+14165550123', ['CA'])?.iso).toBe('CA');
        expect(countryForE164('+77011234567', ['KZ', 'RU'])?.iso).toBe('RU');
    });
});

describe('countryName', () => {
    it('names a country in the reader\'s language', () => {
        expect(countryName('IN')).toBe('India');
        expect(countryName('IN', 'hi')).toBe('भारत');
    });

    it('falls back to the id for a language the browser does not know', () => {
        expect(countryName('GB', 'not a language')).toBe('GB');
    });
});
