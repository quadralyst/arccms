/**
 * "Phone number or email": what someone typed or pasted into the sign-in
 * field, recognised and cleaned up.
 *
 * `cleanPasted`, `cleanEmail` and `normalizePhone` mirror
 * functions/src/auth/pastedText.ts and functions/src/auth/phoneNumber.ts,
 * which have the final say; both are tested against the same cases
 * (functions/src/__tests__/helpers/phoneCases.ts).
 */

export const DEFAULT_COUNTRY_CODE = '91';

/** Invisible characters: soft hyphen, zero-width and direction marks, word joiners, BOM. */
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** The zero of each digit set people in India type in, besides 0-9. */
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66];
const OTHER_DIGITS = /[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF\u0A66-\u0A6F\u0AE6-\u0AEF\u0B66-\u0B6F\u0BE6-\u0BEF\u0C66-\u0C6F\u0CE6-\u0CEF\u0D66-\u0D6F]/g;

function toAsciiDigit(d: string): string {
    const cp = d.codePointAt(0) ?? 0;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9) ?? cp;
    return String(cp - zero);
}

/**
 * The pasted text without what came along unseen from WhatsApp, a contact
 * card or a web page: direction marks, zero-width spaces, full-width forms
 * (NFKC), digits of other scripts, a leading `tel:` or `mailto:`.
 */
export function cleanPasted(raw: unknown): string {
    return String(raw ?? '')
        .normalize('NFKC')
        .replace(INVISIBLE, '')
        .replace(OTHER_DIGITS, toAsciiDigit)
        .trim()
        .replace(/^(tel|mailto):/i, '')
        .trim();
}

/**
 * An email as typed or pasted, ready to check: the address out of
 * `Name <name@example.com>`, without a `?subject=` tail, spaces, wrapping
 * quotes or brackets, or the full stop of a sentence; in lower case.
 */
export function cleanEmail(raw: unknown): string {
    let text = cleanPasted(raw);
    const bracketed = text.match(/<([^<>]*@[^<>]*)>/);
    if (bracketed) text = bracketed[1];
    return text
        .replace(/^mailto:/i, '')
        .replace(/\?.*$/, '')
        .replace(/\s+/g, '')
        .replace(/^[<("'`[]+/, '')
        .replace(/[>)"'`\].,;:!]+$/, '')
        .toLowerCase();
}

/**
 * The digits of a cleaned number, and whether it carries its own country code:
 * a `+` before the first digit (`(+44) 7700`, too) or a leading `00`.
 */
function readDigits(text: string): { digits: string; international: boolean } {
    let digits = text.replace(/\D/g, '');
    const firstDigit = text.search(/\d/);
    let international = text.slice(0, firstDigit < 0 ? text.length : firstDigit).includes('+');
    if (!international && digits.startsWith('00')) {
        digits = digits.slice(2);
        international = true;
    }
    return { digits, international };
}

const INDIAN_MOBILE = /^[6-9]\d{9}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidInternational(digits: string): boolean {
    if (digits.startsWith('91')) return INDIAN_MOBILE.test(digits.slice(2));
    return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0');
}

/** The E.164 form (`+919876543210`), or null when it is not a phone number. */
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
    const full = national.startsWith(cc) && national.length > cc.length + 6 ? national : cc + national;
    return isValidInternational(full) ? `+${full}` : null;
}

/**
 * How a number is shown: an Indian number on an Indian site without `+91`, in
 * two groups (`98765 43210`); anything else in full (`+447700900123`), which
 * reads the same whatever the site's default country.
 */
export function formatPhone(e164: string, defaultCountryCode: string = DEFAULT_COUNTRY_CODE): string {
    const cc = String(defaultCountryCode || DEFAULT_COUNTRY_CODE).replace(/\D/g, '');
    if (cc === '91' && /^\+91\d{10}$/.test(e164)) return `${e164.slice(3, 8)} ${e164.slice(8)}`;
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
    const text = cleanPasted(raw);
    if (text.includes('@')) {
        const email = cleanEmail(text);
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
 * Why the sign-in field cannot be used yet, so the page can say what to fix
 * (keys under `member.auth.identifier_error`), or null when it can.
 */
export type IdentifierProblem =
    | 'empty'
    | 'email'
    | 'not_email'
    | 'not_phone_or_email'
    | 'phone_off'
    | 'phone_short'
    | 'phone_long'
    | 'phone_start'
    | 'phone_country';

export function identifierProblem(
    raw: unknown,
    phoneOn: boolean,
    defaultCountryCode: string = DEFAULT_COUNTRY_CODE,
): IdentifierProblem | null {
    const text = cleanPasted(raw);
    if (!text) return 'empty';
    const id = classifyIdentifier(text, defaultCountryCode);
    if (id.kind === 'email') return null;
    if (text.includes('@')) return 'email';

    const { digits, international } = readDigits(text);
    if (/[a-z]/i.test(text) || !digits) return phoneOn ? 'not_phone_or_email' : 'not_email';
    if (!phoneOn) return 'phone_off';
    if (id.kind === 'phone') return null;
    return phoneProblem(digits, international, String(defaultCountryCode || DEFAULT_COUNTRY_CODE).replace(/\D/g, ''));
}

/** What is wrong with a number `normalizePhone` turned down. */
function phoneProblem(digits: string, international: boolean, cc: string): IdentifierProblem {
    const length = (n: number, min: number, max: number): IdentifierProblem | null =>
        n < min ? 'phone_short' : n > max ? 'phone_long' : null;

    if (international) {
        if (digits.startsWith('91')) return length(digits.length - 2, 10, 10) ?? 'phone_start';
        return length(digits.length, 8, 15) ?? 'phone_country';
    }
    if (cc === '91') {
        let national = digits;
        if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
        else if (national.length === 12 && national.startsWith('91')) national = national.slice(2);
        return length(national.length, 10, 10) ?? 'phone_start';
    }
    const national = digits.replace(/^0+/, '');
    const full = national.startsWith(cc) && national.length > cc.length + 6 ? national : cc + national;
    return length(full.length, 8, 15) ?? 'phone_country';
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
