import { db } from '../init.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';

/**
 * Fields whose options come from another content type ("Use data from another
 * collection"): the entry stores the chosen entry's id under the field's key,
 * and a copy of some of its fields under `_ref_{key}`, which templates read as
 * `ref_{key}` (TemplateHydrationService). The editor writes the copy when the
 * entry is picked; publishing rebuilds it here from the linked entry's
 * published document, so a page always shows what that entry says now.
 */

interface LinkField {
    key: string;
    type: string;
    useCollectionRef?: boolean;
    collectionRef?: { collectionSlug: string; displayField?: string; syncFields?: string[] };
}

/** A field's value on an entry: a built-in field, else a custom field. */
function fieldValue(data: Record<string, any>, key: string): unknown {
    if (data[key] !== undefined) return data[key];
    return (data.customFields as Record<string, any> | undefined)?.[key];
}

/** The copy of one linked entry: its id, the display field and the fields chosen to copy. Pure. */
export function linkedEntryCopy(field: LinkField, id: string, linked: Record<string, any>): Record<string, any> {
    const ref = field.collectionRef!;
    const copy: Record<string, any> = { id };
    for (const key of [ref.displayField || 'title', ...(ref.syncFields || [])]) {
        if (key === 'id') continue;
        const value = fieldValue(linked, key);
        if (value !== undefined) copy[key] = value;
    }
    return copy;
}

/**
 * The entry's custom fields with every linked entry's copy rebuilt from that
 * entry as published now. A linked entry that is no longer published drops
 * out: a single link loses its copy, so `data-arc-if="ref_{key}"` hides it.
 */
export async function refreshLinkedEntries(
    customFields: Record<string, any> | undefined,
    fields: LinkField[] | undefined,
): Promise<Record<string, any>> {
    const result = { ...(customFields || {}) };
    for (const field of fields || []) {
        const slug = field.collectionRef?.collectionSlug;
        if (!field.useCollectionRef || !slug) continue;
        const value = result[field.key];
        const ids = (Array.isArray(value) ? value : [value]).filter((id): id is string => typeof id === 'string' && !!id);
        const refKey = `_ref_${field.key}`;
        if (!ids.length) {
            delete result[refKey];
            continue;
        }

        const collection = db.collection(getPublishedCollectionName(slug));
        const snaps = await db.getAll(...ids.map((id) => collection.doc(id)));
        const copies = snaps.filter((snap) => snap.exists).map((snap) => linkedEntryCopy(field, snap.id, snap.data() || {}));

        if (field.type === 'checkbox') result[refKey] = copies;
        else if (copies.length) result[refKey] = copies[0];
        else delete result[refKey];
    }
    return result;
}
