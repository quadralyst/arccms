/**
 * The order a content type's entries are shown in: on its list page and in a
 * home page card block, published or rendered in the app, and in the admin's
 * Arrange dialog (specs/site-sections-spec.md, SS2).
 *
 * - Newest first (the default): by publish time, newest first.
 * - Your own order: entries with a `sortOrder` first, by that number (ties
 *   newest first); then entries without one, oldest first, so an entry
 *   published after the type was arranged lands at the end.
 *
 * Source of truth: src/app/core/utils/display-order.ts (the app sorts the same
 * way). Keep in sync manually; src/app/core/utils/display-order.spec.ts checks it.
 */

export type EntryOrder = 'newest' | 'manual';

/** A content type's entry order; anything but 'manual' is newest first. */
export function entryOrderOf(type: { entryOrder?: unknown } | null | undefined): EntryOrder {
    return type?.entryOrder === 'manual' ? 'manual' : 'newest';
}

/** Epoch ms of a Firestore Timestamp (client or admin), a Date, an ISO string or a number; 0 when none. */
export function timeOf(value: unknown): number {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (typeof v._seconds === 'number') return v._seconds * 1000;
    const ms = new Date(value as string).getTime();
    return isNaN(ms) ? 0 : ms;
}

function numberOf(value: unknown): number | null {
    return typeof value === 'number' && isFinite(value) ? value : null;
}

/**
 * The entries in display order, as a new array. `when` gives an entry's time:
 * its publish time by default; the Arrange dialog passes the draft's.
 */
export function sortForDisplay<T extends Record<string, any>>(
    entries: readonly T[],
    order: EntryOrder,
    when: (entry: T) => unknown = (entry) => entry['publishedOn'],
): T[] {
    const newestFirst = (a: T, b: T) => timeOf(when(b)) - timeOf(when(a));
    if (order !== 'manual') return [...entries].sort(newestFirst);

    const numbered = entries.filter((e) => numberOf(e['sortOrder']) !== null);
    const unnumbered = entries.filter((e) => numberOf(e['sortOrder']) === null);
    numbered.sort((a, b) => (numberOf(a['sortOrder'])! - numberOf(b['sortOrder'])!) || newestFirst(a, b));
    unnumbered.sort((a, b) => timeOf(when(a)) - timeOf(when(b)));
    return [...numbered, ...unnumbered];
}
