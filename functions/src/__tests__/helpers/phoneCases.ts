/**
 * Typed and pasted numbers and emails, and what they clean up to. Run against
 * both the server (`functions/src/auth/phoneNumber.ts`, `pastedText.ts`) and
 * the browser twin (`src/shared/utils/identifier.util.ts`), so the two cannot drift.
 */
export const PHONE_CASES: Array<[string, string | null]> = [
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['+91-98765 43210', '+919876543210'],
    ['(098765) 43210', '+919876543210'],
    ['098765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['0091 98765 43210', '+919876543210'],
    ['  +91 (987) 654-3210  ', '+919876543210'],
    ['+44 7700 900123', '+447700900123'],
    ['+1 (415) 555-2671', '+14155552671'],
    ['5876543210', null],
    ['12345', null],
    ['+91 12345 67890', null],
    ['987654321', null],
    ['name@example.com', null],
    ['call me', null],
    ['', null],
    // Pasted from WhatsApp, a contact card or a web page (invisible marks included).
    ['\u202A+91 98765 43210\u202C', '+919876543210'],
    ['\u202A+44 7700 900123\u202C', '+447700900123'],
    ['\u200E+1 (415) 555\u20112671', '+14155552671'],
    ['98765\u00A043210', '+919876543210'],
    ['98765\u200B43210', '+919876543210'],
    ['\uFEFF9876543210', '+919876543210'],
    ['(+44) 7700 900123', '+447700900123'],
    ['tel:+919876543210', '+919876543210'],
    ['TEL: 98765 43210', '+919876543210'],
    ['\uFF0B\uFF19\uFF11 \uFF19\uFF18\uFF17\uFF16\uFF15 \uFF14\uFF13\uFF12\uFF11\uFF10', '+919876543210'],
    ['\u096F\u096E\u096D\u096C\u096B \u096A\u0969\u0968\u0967\u0966', '+919876543210'],
    ['+91.98765.43210', '+919876543210'],
    ['+91 98765 43210 ', '+919876543210'],
    ['1234567890', null],
];

/** Pasted emails and the address they clean to (before the format check). */
export const EMAIL_CASES: Array<[string, string]> = [
    ['  Asha.Rao@Example.COM ', 'asha.rao@example.com'],
    ['asha @ example.com', 'asha@example.com'],
    ['\u200Basha@example.com\u200B', 'asha@example.com'],
    ['\u202Aasha@example.com\u202C', 'asha@example.com'],
    ['asha\u00A0@example.com', 'asha@example.com'],
    ['mailto:asha@example.com', 'asha@example.com'],
    ['mailto:asha@example.com?subject=Hello', 'asha@example.com'],
    ['Asha Rao <asha@example.com>', 'asha@example.com'],
    ['"asha@example.com"', 'asha@example.com'],
    ['(asha@example.com)', 'asha@example.com'],
    ['asha@example.com.', 'asha@example.com'],
    ['asha@example.com,', 'asha@example.com'],
    ['asha\uFF20example.com', 'asha@example.com'],
];

