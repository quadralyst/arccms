/**
 * Central registry + helpers for email merge tags (`##TAG##`).
 *
 * Single source of truth for the per-context tag lists that power both the
 * `#`-triggered autocomplete (TipTap body + plain subject inputs) and the
 * existing "Insert Placeholder" chip/dropdown palettes.
 *
 * Tags render as `##UPPER_SNAKE##` and are resolved server-side by
 * `processEmailTemplate` (functions/src/utils/emailTemplateHelper.ts).
 */

/** Canonical tag tokens, so surfaces never hand-type `##...##` strings. */
export const EMAIL_TAG = {
    NAME: '##NAME##',
    EMAIL: '##EMAIL##',
    OTP: '##OTP##',
    COMPANY_NAME: '##COMPANY_NAME##',
    UNSUBSCRIBE_LINK: '##UNSUBSCRIBE_LINK##',
    PREFERENCES_LINK: '##PREFERENCES_LINK##',
    POSITION: '##POSITION##',
    REFERRAL_CODE: '##REFERRAL_CODE##',
    REFERRAL_LINK: '##REFERRAL_LINK##',
    SUBJECT: '##SUBJECT##',
    CONTENT: '##CONTENT##',
    PAYMENT_AMOUNT: '##PAYMENT_AMOUNT##',
    SUBSCRIPTION_PLAN: '##SUBSCRIPTION_PLAN##',
    RENEWAL_DATE: '##RENEWAL_DATE##',
} as const;

/** Named tag contexts. Each maps to the exact list valid for that email type. */
export type EmailTagContext =
    | 'waitlist_verify_otp_email'
    | 'waitlist_welcome_email'
    | 'waitlist_broadcast_email'
    | 'broadcast'
    | 'brand_kit_footer'
    | 'composer_common'
    | 'composer_otp'
    | 'composer_payment';

const T = EMAIL_TAG;

/** The per-context registry. Keep these lists in sync with the server resolver. */
const EMAIL_TAG_REGISTRY: Record<EmailTagContext, string[]> = {
    // Waitlist template editor (templates.page)
    waitlist_verify_otp_email: [T.NAME, T.EMAIL, T.OTP],
    waitlist_welcome_email: [T.NAME, T.EMAIL, T.POSITION, T.REFERRAL_CODE, T.REFERRAL_LINK],
    waitlist_broadcast_email: [T.NAME, T.EMAIL, T.SUBJECT, T.CONTENT, T.UNSUBSCRIBE_LINK],

    // Broadcast email editor
    broadcast: [T.NAME, T.EMAIL, T.SUBJECT, T.UNSUBSCRIBE_LINK],

    // Email brand-kit footer (resolves in every branded email's footer)
    brand_kit_footer: [T.COMPANY_NAME, T.UNSUBSCRIBE_LINK, T.PREFERENCES_LINK],

    // Generic email composer (block editor)
    composer_common: [T.NAME, T.EMAIL, T.COMPANY_NAME, T.UNSUBSCRIBE_LINK, T.PREFERENCES_LINK],
    composer_otp: [T.NAME, T.EMAIL, T.COMPANY_NAME, T.UNSUBSCRIBE_LINK, T.PREFERENCES_LINK, T.OTP],
    composer_payment: [
        T.NAME, T.EMAIL, T.COMPANY_NAME, T.UNSUBSCRIBE_LINK, T.PREFERENCES_LINK,
        T.PAYMENT_AMOUNT, T.SUBSCRIPTION_PLAN, T.RENEWAL_DATE,
    ],
};

/** Return the merge tags valid for a given context (empty array if unknown). */
export function getEmailTags(context: EmailTagContext): string[] {
    return EMAIL_TAG_REGISTRY[context] ? [...EMAIL_TAG_REGISTRY[context]] : [];
}

/**
 * Resolve the composer tag list from an arbitrary template-type string.
 * Mirrors the old `placeholdersFor()` substring matching, but sourced centrally.
 */
export function getComposerTags(type?: string): string[] {
    if (type?.includes('otp')) return getEmailTags('composer_otp');
    if (type?.includes('payment')) return getEmailTags('composer_payment');
    return getEmailTags('composer_common');
}

/** Strip `#` and lowercase, so tags and queries compare on their word core. */
export function normalizeTagQuery(value: string): string {
    return value.replace(/#/g, '').toLowerCase();
}

/**
 * Filter available tags by a typed query (already stripped of the leading `#`).
 * An empty query returns the full list (capped). Matching is case-insensitive
 * and ignores the surrounding `#` characters on both sides.
 */
export function filterEmailTags(tags: string[], query: string, limit = 8): string[] {
    const q = normalizeTagQuery(query ?? '');
    const source = tags ?? [];
    if (!q) return source.slice(0, limit);
    return source.filter((tag) => normalizeTagQuery(tag).includes(q)).slice(0, limit);
}

/**
 * TipTap suggestion `command`: replace the typed `#query` (given by `range`)
 * with the plain `##TAG##` token plus a trailing space. Kept as a plain helper
 * so the body-editor insertion contract is unit-testable without ProseMirror.
 */
export function insertTagMention(
    editor: { chain: () => any },
    range: { from: number; to: number },
    tag: string,
): void {
    editor.chain().focus().deleteRange(range).insertContent(`${tag} `).run();
}

/** An active `#...` token found immediately before the caret in a plain input. */
export interface HashToken {
    /** Index of the first `#` of the token within the value. */
    hashIndex: number;
    /** The typed query after the `#` run (word chars only). */
    query: string;
}

/**
 * Find the active `#`-token ending at the caret in a plain input/textarea value.
 * Returns null when there is no `#` directly before the caret's word, i.e. when
 * whitespace or nothing precedes the caret. Handles single (`#na`) and double
 * (`##na`) hash prefixes so partially-typed `##TAG##` tokens still match.
 */
export function findActiveHashToken(value: string, caret: number): HashToken | null {
    const before = (value ?? '').slice(0, Math.max(0, caret));
    // One-or-more '#' immediately followed by word chars, anchored at the caret.
    const match = /#+(\w*)$/.exec(before);
    if (!match) return null;
    return { hashIndex: match.index, query: match[1] };
}

/**
 * Replace the active `#query` token with the chosen tag and a trailing space,
 * returning the new value and caret position. The trailing space also prevents
 * the freshly-inserted `##` from immediately re-triggering the autocomplete.
 */
export function replaceHashToken(
    value: string,
    caret: number,
    hashIndex: number,
    tag: string,
): { value: string; caret: number } {
    const insert = `${tag} `;
    const safeCaret = Math.max(hashIndex, Math.min(caret, value.length));
    const next = value.slice(0, hashIndex) + insert + value.slice(safeCaret);
    return { value: next, caret: hashIndex + insert.length };
}
