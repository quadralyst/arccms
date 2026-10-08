import { describe, expect, it } from 'vitest';
import { countryByIso } from '../data/countries';
import { chipPhone, countryListText, rememberCountry, rememberedCountry, tidyChipNumber } from './phone-country';

const IN = countryByIso('IN');
const GB = countryByIso('GB');
const RU = countryByIso('RU');

describe('chipPhone', () => {
    it('reads a number in the chip\'s country, or in its own', () => {
        expect(chipPhone('98765 43210', IN)).toBe('+919876543210');
        expect(chipPhone('07700 900123', GB)).toBe('+447700900123');
        expect(chipPhone('8 912 345-67-89', RU)).toBe('+79123456789');
        expect(chipPhone('+44 7700 900123', IN)).toBe('+447700900123');
        expect(chipPhone('asha@example.com', IN)).toBeNull();
        expect(chipPhone('12', IN)).toBeNull();
    });
});

describe('tidyChipNumber', () => {
    it('moves an allowed country\'s code to the chip', () => {
        expect(tidyChipNumber('+44 7700 900123', IN, ['IN', 'GB'])).toEqual({ country: GB, shown: '7700900123' });
        expect(tidyChipNumber('0091 98765 43210', GB, ['IN', 'GB'])).toEqual({ country: IN, shown: '98765 43210' });
    });

    it('keeps a number from elsewhere, or with no list to check, in full', () => {
        expect(tidyChipNumber('+44 7700 900123', IN, ['IN'])).toEqual({ country: IN, shown: '+447700900123' });
        expect(tidyChipNumber('+44 7700 900123', IN, null)).toEqual({ country: IN, shown: '+447700900123' });
    });

    it('shows a number beside the chip without its domestic 0', () => {
        expect(tidyChipNumber('098765 43210', IN, ['IN'])).toEqual({ country: IN, shown: '98765 43210' });
        expect(tidyChipNumber('asha@example.com', IN, ['IN'])).toBeNull();
    });
});

describe('countryListText', () => {
    it('lists the countries in the page language', () => {
        expect(countryListText(['IN'], 'en')).toBe('India');
        expect(countryListText(['IN', 'GB', 'US'], 'en')).toBe('India, United Kingdom, or United States');
        expect(countryListText(['IN', 'GB'], 'hi')).toContain('भारत');
    });
});

describe('the remembered country', () => {
    it('keeps a known country, and ignores anything else stored', () => {
        rememberCountry('GB');
        expect(rememberedCountry()).toBe('GB');
        localStorage.setItem('arc.phoneCountry', 'nonsense');
        expect(rememberedCountry()).toBeNull();
        localStorage.removeItem('arc.phoneCountry');
    });
});
