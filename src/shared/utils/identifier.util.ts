/**
 * "Phone number or email": what someone typed or pasted into the sign-in
 * field, recognised and cleaned up.
 *
 * `normalizePhone` mirrors functions/src/auth/phoneNumber.ts, which has the
 * final say; both are tested against the same cases
 * (functions/src/__tests__/helpers/phoneCases.ts).
 */

export const DEFAULT_COUNTRY_CODE = '91';

const INDIAN_MOBILE = /^[6-9]\d{9}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidInternational(digits: string): boolean {
    if (digits.startsWith('91')) return INDIAN_MOBILE.test(digits.slice(2));
    return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0');
}

/** The E.164 form (`+919876543210`), or null when it is not a phone number. */
export function normalizePhone(raw: unknown, defaultCountryCode: string = DEFAULT_COUNTRY_CODE): string | null {
    const text = String(raw ?? '').trim();
    if (!text || text.includes('@') || /[a-z]/i.test(text)) return null;

    let digits = text.replace(/\D/g, '');
    let international = text.startsWith('+');
    if (!international && digits.startsWith('00')) {
        digits = digits.slice(2);
        international = true;
    }
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
    const full = national.startsWith(cc) && national.length > cc.length + 6 ? national : cc + national;
    return isValidInternational(full) ? `+${full}` : null;
}

/**
 * How a number is shown: without the default country code, in two groups
 * (`98765 43210`); with any other code, in full (`+447700900123`).
 */
export function formatPhone(e164: string, defaultCountryCode: string = DEFAULT_COUNTRY_CODE): string {
    const prefix = `+${defaultCountryCode}`;
    if (e164.startsWith(prefix)) {
        const national = e164.slice(prefix.length);
        return national.length === 10 ? `${national.slice(0, 5)} ${national.slice(5)}` : national;
    }
    return e164;
}

export type Identifier =
    | { kind: 'email'; value: string; display: string }
    | { kind: 'phone'; value: string; display: string }
    | { kind: 'unknown'; value: string; display: string };

/**
 * Recognise an email or a phone number. Anything with `@` is an email;
 * anything else that normalises is a number.
 */
export function classifyIdentifier(raw: unknown, defaultCountryCode: string = DEFAULT_COUNTRY_CODE): Identifier {
    const text = String(raw ?? '').trim();
    if (text.includes('@')) {
        const email = text.replace(/\s+/g, '').toLowerCase();
        return EMAIL_PATTERN.test(email)
            ? { kind: 'email', value: email, display: email }
            : { kind: 'unknown', value: text, display: email };
    }
    const phone = normalizePhone(text, defaultCountryCode);
    return phone
        ? { kind: 'phone', value: phone, display: formatPhone(phone, defaultCountryCode) }
        : { kind: 'unknown', value: text, display: text };
}

/**
 * The digits of a code pasted from a message ("Your code is 482 913."): the
 * first run of exactly `length` digits, spaces and dashes inside it allowed.
 */
export function extractCode(text: string, length = 6): string | null {
    const compact = String(text ?? '').replace(/[\s-]/g, '');
    const match = compact.match(new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`));
    return match ? match[0] : null;
}
