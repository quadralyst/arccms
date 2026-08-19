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
export type RepeaterSubFieldType = 'text' | 'textarea' | 'media';

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
 * An image, an icon, or either — picked through the Media Manager.
 *
 * Occupies **two** row keys rather than one nested object: `key` holds the
 * image URL and `iconKey` holds the icon token. Two flat keys mean a template
 * writes `{{ image }}` and `{{ icon }}` with no nested access, and the icon
 * flattening that already runs per loop row resolves the token for free.
 */
export interface RepeaterMediaSubField extends RepeaterSubFieldBase {
    type: 'media';
    /** Row key for the icon token. `key` holds the image URL. */
    iconKey: string;
    allowImages?: boolean;
    allowIcons?: boolean;
}

export type RepeaterSubField =
    | RepeaterTextSubField
    | RepeaterTextareaSubField
    | RepeaterMediaSubField;

export interface RepeaterSchema {
    /** Singular noun for one row, e.g. "Card". Used in the add button and headings. */
    rowLabel: string;
    subFields: RepeaterSubField[];
    /** Shown above the rows — what this field is for, and how many to expect. */
    hint?: string;
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
                placeholder: 'Find volunteering opportunities',
                translatable: true,
                maxLength: 120,
            },
            {
                type: 'textarea',
                key: 'info',
                label: 'Info',
                rows: 3,
                placeholder: 'Browse verified needs near you, filtered by cause and skill.',
                translatable: true,
                maxLength: 400,
            },
        ],
    },
};

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
        row[sub.key] = '';
        if (sub.type === 'media') row[sub.iconKey] = null;
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
                if (row[sub.key] === undefined) row[sub.key] = '';
                if (sub.type === 'media' && row[sub.iconKey] === undefined) row[sub.iconKey] = null;
            }

            return row;
        });

    return rows;
}

/** True when a row has nothing an editor typed into it. */
export function isRepeaterRowEmpty(row: RepeaterRow, schema: RepeaterSchema): boolean {
    return schema.subFields.every((sub) => {
        const value = row[sub.key];
        const blank = value === null || value === undefined || value === '';
        if (sub.type !== 'media') return blank;
        return blank && !row[sub.iconKey];
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
