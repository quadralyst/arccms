/**
 * Text pasted into "Phone number or email", cleaned before it is read.
 *
 * Copying from WhatsApp, a contact card, a web page or an email brings along
 * things a person cannot see: direction marks around a number, zero-width
 * spaces, non-breaking spaces, full-width or Devanagari digits, a `tel:` or
 * `mailto:` link, a name around an address. Mirrored for the browser in
 * `src/shared/utils/identifier.util.ts`; both specs run the same table
 * (functions/src/__tests__/helpers/phoneCases.ts).
 */

/** Invisible characters: soft hyphen, zero-width and direction marks, word joiners, BOM. */
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** The zero of each digit set people in India type in, besides 0-9. */
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66];
const OTHER_DIGITS = /[٠-٩۰-۹०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g;

function toAsciiDigit(d: string): string {
    const cp = d.codePointAt(0) ?? 0;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9) ?? cp;
    return String(cp - zero);
}

/**
 * The pasted text without its invisible parts: full-width forms folded
 * (NFKC), every digit as 0-9, a leading `tel:` or `mailto:` dropped, trimmed.
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
