/**
 * Repeating fields on the Visual Editor (specs/visual-editing-spec.md, VE-D30):
 * which loop of a template is a repeating field the editor fills, which value
 * of a row a binding shows, and which section heading belongs to which field.
 *
 * A template names a repeating field by its stored key (`events-faq`, or
 * `events_faq` on an older type) or by its bare name (`faq`), as the renderer
 * publishes both (TemplateHydrationService.arrayLoopData).
 */
import type { RowEditing } from '../services/template-hydration.service';
import {
    isRepeaterRowEmpty,
    mediaRowKeys,
    RepeaterMediaSubField,
    repeaterSchema,
    RepeaterSchema,
    RepeaterSubField,
} from '../../../shared/models/repeater.model';

/** The fields of a content type, as far as this needs them. */
export interface RowFieldsType {
    slug: string;
    fields?: { key: string; type: string }[];
}

/** A repeating field: its stored key and its row shape. */
export interface RepeaterFieldRef {
    key: string;
    schema: RepeaterSchema;
}

/** The repeating field a template's name stands for, exactly (no derived suffix), or null. */
export function repeaterFieldOf(name: string, type: RowFieldsType | null): RepeaterFieldRef | null {
    if (!name || !type) return null;
    const candidates = [name, `${type.slug}-${name}`, `${type.slug}_${name}`];
    for (const key of candidates) {
        const field = (type.fields || []).find((f) => f.key === key);
        const schema = field ? repeaterSchema(field.type) : null;
        if (field && schema) return { key: field.key, schema };
    }
    return null;
}

/**
 * The repeating field whose section heading a key is (`faq_heading`,
 * `events-faq_heading`), or null. Only a field whose schema has a heading.
 */
export function headingFieldOf(key: string, type: RowFieldsType | null): RepeaterFieldRef | null {
    if (!key || !type) return null;
    for (const field of type.fields || []) {
        const schema = repeaterSchema(field.type);
        if (!schema?.heading) continue;
        const suffix = `_${schema.heading.key}`;
        if (!key.endsWith(suffix)) continue;
        const base = key.slice(0, -suffix.length);
        if (repeaterFieldOf(base, type)?.key === field.key) return { key: field.key, schema };
    }
    return null;
}

/**
 * The row value a binding shows, and whether it is that value itself (typed in
 * place) or one the site works out from it (`answer_html`, `video_thumb`,
 * `map_embed`, an image's other sizes): null when the row has no such value.
 */
export function rowSubField(schema: RepeaterSchema, key: string): { sub: RepeaterSubField; exact: boolean } | null {
    if (!key) return null;
    for (const sub of schema.subFields) {
        if (key === sub.key) return { sub, exact: true };
    }
    for (const sub of schema.subFields) {
        const keys = sub.type === 'media'
            ? [sub.key, sub.iconKey, sub.videoKey].filter((k): k is string => !!k)
            : sub.type === 'location' ? [sub.key, sub.latKey, sub.lngKey, sub.zoomKey] : [sub.key];
        if (keys.includes(key)) return { sub, exact: false };
        // A value worked out from it: `answer_html`, `video_embed`, `image_640`.
        if (keys.some((k) => key.startsWith(`${k}_`))) return { sub, exact: false };
        // The location's map frame and directions link.
        if (sub.type === 'location' && /^map_/.test(key)) return { sub, exact: false };
    }
    return null;
}

/**
 * How the rows of a template's loop are edited on the page (HydrationOptions.editRows):
 * only a loop that is a repeating field. In a row, an empty text is kept to be filled
 * in, and so is the media's first choice (its image) while the row has no visual at
 * all; its other choices (icon, video) and anything worked out stay as on the page.
 */
export function rowEditing(loop: string, type: RowFieldsType | null): RowEditing | null {
    const field = repeaterFieldOf(loop, type);
    if (!field) return null;
    const texts = new Set(field.schema.subFields.filter((s) => s.type === 'text' || s.type === 'textarea').map((s) => s.key));
    const media = field.schema.subFields.filter((s): s is RepeaterMediaSubField => s.type === 'media');
    return {
        keepEmpty: (key, row) => {
            if (texts.has(key)) return true;
            // A value worked out from a text (`answer_html`): kept, so a blank row's answer has a place.
            const derived = rowSubField(field.schema, key);
            if (derived && (derived.sub.type === 'text' || derived.sub.type === 'textarea')) return true;
            const sub = media.find((m) => m.key === key);
            return !!sub && mediaRowKeys(sub).every((k) => !row[k]);
        },
    };
}

/**
 * The entry without blank rows in its repeating fields: what every page but the
 * Visual Editor's draws, as a save would store it (VE-D33). The same entry when
 * there is nothing to drop.
 */
export function withoutBlankRows<T extends { customFields?: Record<string, any> }>(entry: T, type: RowFieldsType | null): T {
    const fields = entry?.customFields;
    if (!fields || !type) return entry;
    let changed: Record<string, any> | null = null;
    for (const field of type.fields || []) {
        const schema = repeaterSchema(field.type);
        const rows = fields[field.key];
        if (!schema || !Array.isArray(rows)) continue;
        const kept = rows.filter((row) => !row || typeof row !== 'object' || !isRepeaterRowEmpty(row, schema));
        if (kept.length === rows.length) continue;
        changed = { ...(changed ?? fields), [field.key]: kept };
    }
    return changed ? { ...entry, customFields: changed } : entry;
}
