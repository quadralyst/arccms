/**
 * One person holds an entry or a page (specs/visual-editing-spec.md, VE-D76 to
 * VE-D78): whoever has unpublished changes, until they are published or
 * discarded, or someone takes over. Kept on the draft as `editing`, written with
 * every save; nothing runs while a page is only open.
 */
export interface EditingHold {
    /** The account (Firebase Auth uid) that holds it. */
    by: string;
    /** Their name as it was when they saved, so nobody's account has to be read. */
    name: string;
    /** When they started, and their last change. */
    since?: unknown;
    at?: unknown;
    /** Set by a take over: the kept draft (VE-D84) it made. */
    kept?: string;
}

/** Who is editing here: the signed-in person. */
export interface EditorPerson {
    uid: string;
    name: string;
}

/** The hold a stored draft carries, or null. */
export function holdOf(data: { editing?: unknown } | null | undefined): EditingHold | null {
    const editing = data?.editing as Partial<EditingHold> | null | undefined;
    if (!editing || typeof editing !== 'object' || typeof editing.by !== 'string' || !editing.by) return null;
    return { ...editing, by: editing.by, name: typeof editing.name === 'string' ? editing.name : '' };
}

/** The hold someone else has on a draft, or null when it is nobody's or this person's. */
export function heldByOther(data: { editing?: unknown } | null | undefined, uid: string | null | undefined): EditingHold | null {
    const hold = holdOf(data);
    return hold && hold.by !== uid ? hold : null;
}

/** A save found that someone else holds the draft. Nothing was written. */
export class HeldError extends Error {
    readonly code = 'arc/held';
    constructor(readonly hold: EditingHold) {
        super(`${hold.name || 'Someone else'} is editing this.`);
        this.name = 'HeldError';
    }
}

/** True for a HeldError, also one that crossed an Observable or a transaction. */
export function isHeld(error: unknown): error is HeldError {
    return error instanceof HeldError || (error as { code?: string } | null)?.code === 'arc/held';
}

/** A take over asks more strongly when the other person changed something this recently. */
export const JUST_NOW_MS = 5 * 60_000;

/** Whether the last change under a hold was moments ago. */
export function changedJustNow(hold: EditingHold | null, now: number): boolean {
    const at = momentMillis(hold?.at);
    return at !== null && now - at < JUST_NOW_MS;
}

/** A stored time in milliseconds: a Timestamp, a copy of one, a Date or a number. */
export function momentMillis(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const v = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1e6);
    if (value instanceof Date) return value.getTime();
    return typeof value === 'number' ? value : null;
}
