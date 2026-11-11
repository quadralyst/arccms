/**
 * Two admins on one entry (specs/dev-review-fixes-spec.md, RF4 4.5): a save
 * checks that the stored entry is still the one the editor opened. Its
 * `modifiedAt` is the mark: every write of the entry sets it.
 */

/** A save found the entry changed by someone else since the editor opened it. */
export class EntryChangedError extends Error {
    readonly code = 'arc/entry-changed';
    constructor() {
        super('Someone else changed this entry since it was opened.');
        this.name = 'EntryChangedError';
    }
}

/** A save found the entry deleted (by another admin) since the editor opened it. */
export class EntryGoneError extends Error {
    readonly code = 'arc/entry-gone';
    constructor() {
        super('This entry was deleted.');
        this.name = 'EntryGoneError';
    }
}

/** True for an EntryGoneError, also one that crossed an Observable or a transaction. */
export function isEntryGone(error: unknown): boolean {
    return error instanceof EntryGoneError || (error as { code?: string } | null)?.code === 'arc/entry-gone';
}

/** True for an EntryChangedError, also one that crossed an Observable or a transaction. */
export function isEntryChanged(error: unknown): boolean {
    return error instanceof EntryChangedError || (error as { code?: string } | null)?.code === 'arc/entry-changed';
}

/**
 * A stored time as milliseconds: a Firestore Timestamp, a `{ seconds,
 * nanoseconds }` copy of one, a Date, a number or a date string. Null when
 * there is no time to read.
 */
export function stampMillis(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const v = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1e6);
    const time = value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
    return Number.isNaN(time) ? null : time;
}

/**
 * Whether a save must stop: the editor opened the entry at `opened` and the
 * stored copy now says `stored`. Without a time on either side (an entry from
 * before the field, a save told to overwrite) there is nothing to compare.
 */
export function changedSinceOpened(opened: unknown, stored: unknown): boolean {
    const was = stampMillis(opened);
    const now = stampMillis(stored);
    return was !== null && now !== null && was !== now;
}
