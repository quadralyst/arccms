/**
 * Library files as content stores them and templates show them
 * (docs/features/templates.html, File fields; MF-D18).
 *
 * A `file` field stores a list of rows, `{ url, title, type, bytes, pages? }`,
 * also when it holds one file. Hydration finds such a list by its shape (every
 * row has a string `url` and a number `bytes`), like images by their URL.
 *
 * Source of truth; functions/src/shared/file-rows.ts is a mirror for the Cloud
 * Functions build, which cannot import from src/. A parity spec keeps them
 * agreeing.
 */

/** The kinds of file the library keeps. */
export type MediaFileType = 'pdf' | 'word' | 'excel' | 'powerpoint' | 'csv' | 'text';

/** A library file as content and the picker hand it around. */
export interface MediaFileRef {
    id?: string;
    url: string;
    title: string;
    type: MediaFileType;
    bytes: number;
    pages?: number;
}

/** The label each type shows: "PDF", "Word". */
export const MEDIA_FILE_TYPE_LABELS: Record<MediaFileType, string> = {
    pdf: 'PDF',
    word: 'Word',
    excel: 'Excel',
    powerpoint: 'PowerPoint',
    csv: 'CSV',
    text: 'Text',
};

/** "2.3 MB", "640 KB", "12 bytes". One decimal from 1 MB up; whole numbers below. */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${Math.round(bytes)} bytes`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "PDF · 2.3 MB", or "PDF · 2.3 MB · 24 pages" when asked for pages. */
export function fileMeta(file: Pick<MediaFileRef, 'type' | 'bytes' | 'pages'>, pagesLabel?: (pages: number) => string): string {
    const parts = [MEDIA_FILE_TYPE_LABELS[file.type] ?? '', formatBytes(file.bytes)].filter(Boolean);
    if (pagesLabel && file.pages) parts.push(pagesLabel(file.pages));
    return parts.join(' · ');
}

/** True when `value` looks like a stored file row: a URL and a size in bytes. */
export function isFileRow(value: unknown): value is MediaFileRef {
    const row = value as Partial<MediaFileRef> | null;
    return !!row && typeof row === 'object' && typeof row.url === 'string' && !!row.url && typeof row.bytes === 'number';
}

/** True when `value` is a non-empty list of file rows: a `file` field's value. */
export function isFileList(value: unknown): value is MediaFileRef[] {
    return Array.isArray(value) && value.length > 0 && value.every(isFileRow);
}

/**
 * The rows a `file` field stores: `{ url, title, type, bytes, pages? }`, never
 * a library id or anything else the picker carried. Anything that is not a
 * file row is dropped.
 */
export function toFileRows(value: unknown): MediaFileRef[] {
    if (!Array.isArray(value)) return [];
    return value.filter(isFileRow).map((row) => {
        const out: MediaFileRef = { url: row.url, title: row.title || '', type: row.type, bytes: row.bytes };
        if (row.pages) out.pages = row.pages;
        return out;
    });
}

/**
 * One file as a template loop row: `{{ url }}`, `{{ title }}`, `{{ type }}`
 * ("PDF"), `{{ kind }}` ("pdf", for a class name), `{{ size }}` ("2.3 MB"),
 * `{{ pages }}`.
 */
export function fileLoopRow(row: MediaFileRef): Record<string, string | number> {
    return {
        url: row.url,
        title: row.title || '',
        type: MEDIA_FILE_TYPE_LABELS[row.type] ?? '',
        kind: row.type ?? '',
        size: formatBytes(row.bytes),
        bytes: row.bytes,
        pages: row.pages ?? '',
    };
}

/**
 * The bindings a file list adds beside itself, from its first file, so a
 * template can link one file without a loop: `{{ key_url }}`,
 * `{{ key_title }}`, `{{ key_type }}`, `{{ key_size }}`, `{{ key_pages }}`.
 */
export function fileSiblings(key: string, files: MediaFileRef[]): Record<string, string | number> {
    const first = fileLoopRow(files[0]);
    return {
        [`${key}_url`]: first['url'],
        [`${key}_title`]: first['title'],
        [`${key}_type`]: first['type'],
        [`${key}_size`]: first['size'],
        [`${key}_pages`]: first['pages'],
    };
}
