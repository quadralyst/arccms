/**
 * Repeating custom fields — a field whose value is a list of fixed-shape rows.
 *
 * Every custom field before this one held a scalar (or a single object, for an
 * icon or a collection reference). Info Cards, galleries and label/value pairs
 * are all the same shape underneath: an array of rows with the same sub-fields.
 * So the machinery is built once here and exposed as concrete, named field
 * types — an editor picks "Info Card", not "array with a schema".
 *
 * Adding a new repeating field type is a `REPEATER_SCHEMAS` entry, not new
 * code.
 *
 * ## Row identity
 *
 * Every row carries a generated `id` that never changes. Nothing in this file
 * needs it yet — translations do. Translations of a row's prose are keyed by
 * `id` rather than by array index, because an index moves: delete the second
 * of four cards and every later translation silently shifts onto the wrong
 * card, publishing the wrong text under the wrong headline with no error.
 *
 * Ids are therefore written from day one, even though the translation work
 * comes later, so no live content has to be migrated to gain them.
 */

/** Sub-field kinds a repeater row can be built from. */
export type RepeaterSubFieldType = 'text' | 'textarea' | 'media' | 'location';

interface RepeaterSubFieldBase {
    /** Row key this sub-field writes to, and the template binding name. */
    key: string;
    label: string;
    required?: boolean;
    placeholder?: string;
    /**
     * Whether this sub-field holds prose that should be translated.
     *
     * Read by the translation work; declared now so the schemas do not need
     * revisiting then.
     */
    translatable?: boolean;
}

export interface RepeaterTextSubField extends RepeaterSubFieldBase {
    type: 'text';
    maxLength?: number;
}

export interface RepeaterTextareaSubField extends RepeaterSubFieldBase {
    type: 'textarea';
    rows?: number;
    maxLength?: number;
}

/**
 * The visual for a row — an image, an icon, or a YouTube video, whichever the
 * schema allows. A row holds exactly one of them; picking one clears the rest.
 *
 * Occupies a **separate flat row key per alternative** rather than one nested
 * object: `key` holds the image URL, `iconKey` the icon token, `videoKey` the
 * YouTube URL. Flat keys mean a template writes `{{ image }}`, `{{ icon }}`
 * and `{{ video_embed }}` with no nested access, the icon flattening that
 * already runs per loop row resolves the token for free, and a template can
 * pick between them with `data-arc-if`.
 */
export interface RepeaterMediaSubField extends RepeaterSubFieldBase {
    type: 'media';
    /** Row key for the icon token. Omit when icons are not offered. */
    iconKey?: string;
    /** Row key for the YouTube URL. Omit when video is not offered. */
    videoKey?: string;
    allowImages?: boolean;
    allowIcons?: boolean;
    allowVideo?: boolean;
    /**
     * Offer a field-level "add several at once" button.
     *
     * Only worth it where a row is mostly its image — building a twelve-photo
     * gallery one row at a time is the tedium this removes. An Info Card needs
     * a headline per row, so bulk-adding would just make blank cards.
     */
    allowBulkAdd?: boolean;
}

/**
 * A point on a map, picked by searching an address or dragging a marker.
 *
 * Occupies **four** row keys rather than one nested object, for the same
 * reason the media sub-field does: a template writes `{{ lat }}` and
 * `{{ address }}` with no nested access, and the render-time derivation that
 * turns coordinates into an embed URL works on flat keys.
 *
 * `key` holds the address, because that is the part a page usually prints.
 */
export interface RepeaterLocationSubField extends RepeaterSubFieldBase {
    type: 'location';
    /** Row key for the latitude. */
    latKey: string;
    /** Row key for the longitude. */
    lngKey: string;
    /** Row key for the zoom the editor left the map at. */
    zoomKey: string;
}

export type RepeaterSubField =
    | RepeaterTextSubField
    | RepeaterTextareaSubField
    | RepeaterMediaSubField
    | RepeaterLocationSubField;

/**
 * An editable heading for the whole field, above the rows.
 *
 * Not a row and not a sub-field — one value for the entire block, like the
 * "At a glance" title over a facts list. It is stored as a sibling entry in
 * `customFields` under `<fieldKey>_<key>` rather than inside the rows array,
 * so the stored value of a repeating field stays a plain array and every
 * consumer that assumes that keeps working.
 */
export interface RepeaterHeading {
    /** Suffix on the field key — `heading` gives `details_heading`. */
    key: string;
    label: string;
    placeholder?: string;
    translatable?: boolean;
}

export interface RepeaterSchema {
    /** Singular noun for one row, e.g. "Card". Used in the add button and headings. */
    rowLabel: string;
    subFields: RepeaterSubField[];
    /** Shown above the rows — what this field is for, and how many to expect. */
    hint?: string;
    /**
     * Lay a row's sub-fields out side by side rather than stacked.
     *
     * Worth it only for short paired values: a label and a value stacked in
     * the ~280px custom-fields sidebar is eight inputs for a four-row card.
     */
    layout?: 'stacked' | 'inline';
    /** An editable title for the whole block. */
    heading?: RepeaterHeading;
}

/** One stored row. `id` and `position` are implicit on every repeater. */
export interface RepeaterRow {
    id: string;
    position: number;
    [key: string]: unknown;
}

/**
 * The repeating field types, by `ContentTypeField.type`.
 *
 * Keys are lowercase single words to match the existing type names
 * (`richtext`, `datetime`).
 */
export const REPEATER_SCHEMAS: Record<string, RepeaterSchema> = {
    infocard: {
        rowLabel: 'Card',
        hint: 'Each card shows an icon or image, a headline and a short paragraph. Most layouts read best with three or four.',
        subFields: [
            {
                type: 'media',
                key: 'image',
                iconKey: 'icon',
                label: 'Icon or Image',
                allowImages: true,
                allowIcons: true,
            },
            {
                type: 'text',
                key: 'headline',
                label: 'Headline',
                required: true,
                placeholder: 'Short headline',
                translatable: true,
                maxLength: 120,
            },
            {
                type: 'textarea',
                key: 'info',
                label: 'Info',
                rows: 3,
                placeholder: 'A sentence or two explaining this card.',
                translatable: true,
                maxLength: 400,
            },
        ],
    },
    gallery: {
        rowLabel: 'Item',
        hint: 'Each item is a photo or a YouTube video, with an optional caption. Use "Add photos" to bring in several images at once.',
        subFields: [
            {
                type: 'media',
                key: 'image',
                videoKey: 'video',
                label: 'Photo or Video',
                allowImages: true,
                allowVideo: true,
                allowBulkAdd: true,
            },
            {
                type: 'text',
                key: 'caption',
                label: 'Caption',
                placeholder: 'Describe this photo or video',
                translatable: true,
                maxLength: 200,
            },
        ],
    },
    labelvalue: {
        rowLabel: 'Row',
        layout: 'inline',
        hint: 'Short label-and-value pairs, shown as a facts list. Good for specifications, key figures or anything read at a glance.',
        heading: {
            key: 'heading',
            label: 'Section heading',
            placeholder: 'At a glance',
            translatable: true,
        },
        subFields: [
            {
                type: 'text',
                key: 'label',
                label: 'Label',
                required: true,
                placeholder: 'Label',
                translatable: true,
                maxLength: 60,
            },
            {
                type: 'text',
                key: 'value',
                label: 'Value',
                required: true,
                placeholder: 'Value',
                translatable: true,
                maxLength: 80,
            },
        ],
    },
    maplocation: {
        rowLabel: 'Location',
        hint: 'Each location shows a small map, its address and a directions link. Search for an address or drag the marker to place it exactly.',
        heading: {
            key: 'heading',
            label: 'Section heading',
            placeholder: 'Find us',
            translatable: true,
        },
        subFields: [
            {
                type: 'text',
                key: 'label',
                label: 'Name',
                placeholder: 'What is at this location',
                translatable: true,
                maxLength: 80,
            },
            {
                type: 'location',
                key: 'address',
                latKey: 'lat',
                lngKey: 'lng',
                zoomKey: 'zoom',
                label: 'Location',
                required: true,
                translatable: true,
            },
        ],
    },
};

/** Every row key a location sub-field owns, `key` (the address) first. */
export function locationRowKeys(sub: RepeaterLocationSubField): string[] {
    return [sub.key, sub.latKey, sub.lngKey, sub.zoomKey];
}

/** Every row key a media sub-field owns, `key` first. */
export function mediaRowKeys(sub: RepeaterMediaSubField): string[] {
    return [sub.key, sub.iconKey, sub.videoKey].filter((k): k is string => !!k);
}

/**
 * The `customFields` key holding a repeating field's heading, or null when the
 * schema declares none.
 *
 * `fieldKey` is the stored key, slug prefix and all — so an `events` type with
 * a field keyed `events_details` keeps its heading at
 * `events_details_heading`.
 */
export function repeaterHeadingKey(fieldKey: string, schema: RepeaterSchema): string | null {
    return schema.heading ? `${fieldKey}_${schema.heading.key}` : null;
}

/** Whether a content-type field type stores repeating rows. */
export function isRepeaterType(type: string | undefined): boolean {
    return !!type && Object.prototype.hasOwnProperty.call(REPEATER_SCHEMAS, type);
}

/** The schema for a repeating field type, or null for anything else. */
export function repeaterSchema(type: string | undefined): RepeaterSchema | null {
    return isRepeaterType(type) ? REPEATER_SCHEMAS[type!] : null;
}

/**
 * A short, collision-resistant row id.
 *
 * `crypto.randomUUID` where it exists — every browser this admin supports, and
 * Node 19+. The fallback is not a security boundary: ids only need to be
 * unique within one field of one document, where a few dozen rows is a lot.
 */
export function makeRowId(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `r_${uuid.slice(0, 8)}`;
    return `r_${Math.random().toString(36).slice(2, 10)}`;
}

/** A blank row with every sub-field present, ready to edit. */
export function newRepeaterRow(schema: RepeaterSchema, position: number): RepeaterRow {
    const row: RepeaterRow = { id: makeRowId(), position };

    for (const sub of schema.subFields) {
        if (sub.type === 'media') {
            for (const key of mediaRowKeys(sub)) {
                // The icon slot holds an object; the URL slots hold strings.
                row[key] = key === sub.iconKey ? null : '';
            }
        } else if (sub.type === 'location') {
            // Coordinates are null, not 0 — 0,0 is a real place in the Atlantic
            // and would put a marker there rather than showing "not set".
            row[sub.key] = '';
            row[sub.latKey] = null;
            row[sub.lngKey] = null;
            row[sub.zoomKey] = null;
        } else {
            row[sub.key] = '';
        }
    }

    return row;
}

/**
 * Rows in display order.
 *
 * Ties break on the original array order rather than on anything in the row:
 * two rows both at position 2 should stay where the editor last saw them, not
 * swap on every render.
 */
export function sortRepeaterRows<T extends RepeaterRow>(rows: T[]): T[] {
    return rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => (a.row.position - b.row.position) || (a.index - b.index))
        .map(({ row }) => row);
}

/** Positions renumbered 1..n in current order, so the numbers stay readable. */
export function renumberRepeaterRows<T extends RepeaterRow>(rows: T[]): T[] {
    return rows.map((row, index) => ({ ...row, position: index + 1 }));
}

/**
 * A deep copy of the rows.
 *
 * The editor holds `customFieldValues` and snapshots it with a shallow spread
 * (`{ ...customFieldValues }`) for drafts and version history. A shallow copy
 * shares the array *and* every row object, so editing a row after restoring a
 * version would reach back into the snapshot. Scalars never had this problem;
 * rows do.
 */
export function cloneRepeaterRows<T extends RepeaterRow>(rows: T[]): T[] {
    return rows.map((row) => ({ ...row }));
}

/**
 * Coerces a stored value into usable rows.
 *
 * Documents predating a schema change — or written by an import — may hold
 * rows with missing sub-fields, no id, or no position. Repairing on read keeps
 * every consumer from re-checking, and means an older document simply opens
 * rather than erroring.
 *
 * Repairs only — it deliberately does **not** sort. The editor re-reads rows
 * on every change-detection pass, so sorting here would reorder the list on
 * each keystroke of a position input and slide the row out from under the
 * cursor. Callers that want display order call `sortRepeaterRows` at the
 * moments order should actually change: on load, on commit, and on save.
 */
export function normalizeRepeaterRows(value: unknown, schema: RepeaterSchema): RepeaterRow[] {
    if (!Array.isArray(value)) return [];

    const rows = value
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry, index) => {
            const row: RepeaterRow = {
                ...entry,
                id: typeof entry['id'] === 'string' && entry['id'] ? entry['id'] : makeRowId(),
                position: typeof entry['position'] === 'number' ? entry['position'] : index + 1,
            };

            for (const sub of schema.subFields) {
                if (sub.type === 'media') {
                    for (const key of mediaRowKeys(sub)) {
                        if (row[key] !== undefined) continue;
                        row[key] = key === sub.iconKey ? null : '';
                    }
                } else if (sub.type === 'location') {
                    if (row[sub.key] === undefined) row[sub.key] = '';
                    for (const key of [sub.latKey, sub.lngKey, sub.zoomKey]) {
                        if (row[key] === undefined) row[key] = null;
                    }
                } else if (row[sub.key] === undefined) {
                    row[sub.key] = '';
                }
            }

            return row;
        });

    return rows;
}

/** True when a row has nothing an editor typed into it. */
export function isRepeaterRowEmpty(row: RepeaterRow, schema: RepeaterSchema): boolean {
    const blank = (value: unknown) => value === null || value === undefined || value === '';

    return schema.subFields.every((sub) => {
        if (sub.type === 'media') return mediaRowKeys(sub).every((key) => blank(row[key]));
        if (sub.type === 'location') return locationRowKeys(sub).every((key) => blank(row[key]));
        return blank(row[sub.key]);
    });
}

/**
 * Rows ready to store: normalised, sorted, renumbered, and with fully blank
 * rows dropped.
 *
 * Dropping blanks matters because the editor adds an empty row on demand — an
 * abandoned one would otherwise publish as an empty card.
 */
export function prepareRepeaterRowsForSave(value: unknown, schema: RepeaterSchema): RepeaterRow[] {
    const rows = sortRepeaterRows(normalizeRepeaterRows(value, schema))
        .filter((row) => !isRepeaterRowEmpty(row, schema));
    return renumberRepeaterRows(rows);
}
