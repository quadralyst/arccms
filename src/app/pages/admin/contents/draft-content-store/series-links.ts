import { INextContentReference } from './draft-contents.model';

/**
 * Entries in a series point at each other through `nextContent` and
 * `previousContent`: a copy of the other entry's id, title, summary and slug,
 * picked in the editor. These are the rules that keep the two sides in step.
 * Pure, so the editor, the draft service and the tests share one definition.
 */

export type SeriesField = 'nextContent' | 'previousContent';

export const SERIES_FIELDS: readonly SeriesField[] = ['nextContent', 'previousContent'];

/** The field on the other entry that points back: my Next is its Previous. */
export const BACKLINK_FIELD: Record<SeriesField, SeriesField> = {
    nextContent: 'previousContent',
    previousContent: 'nextContent',
};

/** The links an entry holds, as stored or as about to be saved. */
export interface SeriesLinks {
    nextContent?: INextContentReference | null;
    previousContent?: INextContentReference | null;
}

/**
 * One change to another entry's backlink. `set` points it at the saved entry
 * unless an editor pointed it somewhere else; `clear` empties it only while it
 * still points at the saved entry.
 */
export interface BacklinkChange {
    targetId: string;
    field: SeriesField;
    action: 'set' | 'clear';
}

/** The reference other entries store for an entry, from its saved values. */
export function seriesReference(
    id: string,
    values: { title?: string | null; metaDescription?: string | null; urlSlug?: string | null },
): INextContentReference {
    return {
        id,
        title: values.title || '',
        summary: values.metaDescription || '',
        slug: values.urlSlug || '',
    };
}

/** The id a link points at, '' for none. */
export function linkedId(ref: INextContentReference | null | undefined): string {
    return ref?.id || '';
}

/** What applying a save's backlink changes did: the entries it changed, and the changes that failed. */
export interface BacklinkResult {
    changed: string[];
    failed: BacklinkChange[];
}

/**
 * The backlink changes one save asks for. `before` is what was stored before
 * the save (null for a new entry), `after` what was just written. A link that
 * now points at a new entry asks for that entry's backlink; a link that moved
 * away from an entry or was removed asks for that entry's backlink to be
 * cleared. An unchanged link asks for nothing, so an editor open on a stale
 * copy never puts back a link removed elsewhere (a rename is refreshed by
 * refreshedReference instead). A link to the entry itself, or a placeholder
 * id, is ignored.
 */
export function planBacklinks(
    ownerId: string,
    before: SeriesLinks | null | undefined,
    after: SeriesLinks,
): BacklinkChange[] {
    if (!isRealId(ownerId)) return [];
    const changes: BacklinkChange[] = [];
    for (const field of SERIES_FIELDS) {
        const was = linkedId(before?.[field]);
        const now = linkedId(after[field]);
        const backlink = BACKLINK_FIELD[field];
        if (was && was !== now && was !== ownerId && isRealId(was)) {
            changes.push({ targetId: was, field: backlink, action: 'clear' });
        }
        if (now && now !== was && now !== ownerId && isRealId(now)) {
            changes.push({ targetId: now, field: backlink, action: 'set' });
        }
    }
    return changes;
}

/**
 * What to write to a backlink field, given what it holds now. Returns
 * `undefined` when nothing should be written: a backlink an editor pointed at
 * another entry is never overwritten or cleared, and an unchanged one is not
 * rewritten (that would mark the entry edited for nothing).
 */
export function backlinkValue(
    current: INextContentReference | null | undefined,
    action: BacklinkChange['action'],
    owner: INextContentReference,
): INextContentReference | null | undefined {
    const pointsAtOwner = linkedId(current) === owner.id;
    if (action === 'clear') {
        return pointsAtOwner ? null : undefined;
    }
    // A 'temp-id' left by older versions points nowhere, so it counts as empty.
    if (current && isRealId(current.id) && !pointsAtOwner) return undefined;
    return sameReference(current, owner) ? undefined : { ...owner };
}

/**
 * The refreshed copy of a renamed entry in another entry's link, or
 * `undefined` when the stored copy already matches.
 */
export function refreshedReference(
    current: INextContentReference | null | undefined,
    owner: INextContentReference,
): INextContentReference | undefined {
    if (linkedId(current) !== owner.id) return undefined;
    return sameReference(current, owner) ? undefined : { ...owner };
}

function sameReference(a: INextContentReference | null | undefined, b: INextContentReference): boolean {
    return !!a
        && a.id === b.id
        && (a.title || '') === b.title
        && (a.summary || '') === b.summary
        && (a.slug || '') === b.slug;
}

/** An id a document can have; the editor once wrote 'temp-id' before the first save. */
export function isRealId(id: string | null | undefined): boolean {
    return !!id && id !== 'temp-id';
}
