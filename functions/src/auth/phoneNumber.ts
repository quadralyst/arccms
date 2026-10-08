/**
 * Phone numbers for sign-in: one canonical form, E.164 (`+919876543210`).
 *
 * People paste numbers in every shape (`+91 98765-43210`, `098765 43210`,
 * `919876543210`), so everything is reduced to digits and read against the
 * site's default country code. Mirrored for the browser in
 * `src/shared/utils/identifier.util.ts`; both specs run the same table.
 */
import { createHash } from 'node:crypto';
import { cleanPasted } from './pastedText.js';

export const DEFAULT_COUNTRY_CODE = '91';

/** Indian mobile numbers: ten digits starting 6 to 9. */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

function isValidInternational(digits: string): boolean {
    if (digits.startsWith('91')) return INDIAN_MOBILE.test(digits.slice(2));
    return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0');
}

/**
 * Whether a number typed without `+` already starts with the country code
 * (`447700900123` on a UK site). Under `+1` and `+7` every number is ten digits
 * after the code, and many Kazakh numbers start with 7 themselves, so only the
 * full eleven digits count as carrying the code there.
 */
function startsWithCode(national: string, cc: string): boolean {
    if (!national.startsWith(cc)) return false;
    return cc.length === 1 ? national.length === 11 : national.length > cc.length + 6;
}

/**
 * The digits of a cleaned number, and whether it carries its own country code:
 * a `+` before the first digit (`(+44) 7700`, too) or a leading `00`.
 */
export function readDigits(text: string): { digits: string; international: boolean } {
    let digits = text.replace(/\D/g, '');
    const firstDigit = text.search(/\d/);
    let international = text.slice(0, firstDigit < 0 ? text.length : firstDigit).includes('+');
    if (!international && digits.startsWith('00')) {
        digits = digits.slice(2);
        international = true;
    }
    return { digits, international };
}

/**
 * The E.164 form of a typed or pasted number, or null when it is not one.
 * A leading `+` or `00` means the number carries its own country code;
 * otherwise `defaultCountryCode` applies.
 */
export function normalizePhone(raw: unknown, defaultCountryCode: string = DEFAULT_COUNTRY_CODE): string | null {
    const text = cleanPasted(raw);
    if (!text || text.includes('@') || /[a-z]/i.test(text)) return null;

    const { digits, international } = readDigits(text);
    if (!digits) return null;

    if (international) {
        return isValidInternational(digits) ? `+${digits}` : null;
    }

    const cc = String(defaultCountryCode || DEFAULT_COUNTRY_CODE).replace(/\D/g, '');
    if (cc === '91') {
        let national = digits;
        if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
        else if (national.length === 12 && national.startsWith('91')) national = national.slice(2);
        return INDIAN_MOBILE.test(national) ? `+91${national}` : null;
    }

    const national = digits.replace(/^0+/, '');
    const full = startsWithCode(national, cc) ? national : cc + national;
    return isValidInternational(full) ? `+${full}` : null;
}

/**
 * Whether an E.164 number starts with one of the allowed country codes. An empty
 * list allows nothing (review F): it used to allow every country, so clearing
 * the field opened SMS to numbers anywhere, and their cost.
 */
export function isAllowedCountry(e164: string, allowedCountryCodes: readonly string[]): boolean {
    if (!allowedCountryCodes.length) return false;
    return allowedCountryCodes.some((code) => e164.startsWith(`+${String(code).replace(/\D/g, '')}`));
}

/** Stable key for a number: the document id in `phone_index` and `phone_otps`. */
export function phoneHash(e164: string): string {
    return createHash('sha256').update(e164).digest('hex');
}

/** `+91 ••••• 43210`: enough for a person to recognise their own number. */
export function maskPhone(e164: string): string {
    if (!e164) return '';
    return `${e164.slice(0, 3)} ••••• ${e164.slice(-5)}`;
}
