/**
 * Typed and pasted numbers and what they normalise to. Run against both the
 * server (`functions/src/auth/phoneNumber.ts`) and the browser twin
 * (`src/shared/utils/identifier.util.ts`), so the two cannot drift.
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
];

