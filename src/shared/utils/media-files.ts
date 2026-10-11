/**
 * Documents in the media library (docs/features/media.html, Files).
 *
 * One table decides which files the Files tab takes, the content type each is
 * stored with, and whether a browser opens it or downloads it. The type comes
 * from the file's extension, never the browser's guess: Windows calls a CSV
 * `application/vnd.ms-excel` and some browsers give no type at all. The
 * storage rules (storage.rules, `isLibraryFile`) hold the same pairs; a spec
 * checks the two agree.
 */
import { MediaFileType } from './file-rows';

export { fileMeta, formatBytes, isFileRow, MEDIA_FILE_TYPE_LABELS, toFileRows } from './file-rows';
export type { MediaFileRef, MediaFileType } from './file-rows';

export interface AllowedFile {
    extension: string;
    contentType: string;
    type: MediaFileType;
    /** `inline` opens in a browser tab; `attachment` downloads. */
    disposition: 'inline' | 'attachment';
}

export const ALLOWED_FILES: readonly AllowedFile[] = [
    { extension: 'pdf', contentType: 'application/pdf', type: 'pdf', disposition: 'inline' },
    { extension: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', type: 'word', disposition: 'attachment' },
    { extension: 'doc', contentType: 'application/msword', type: 'word', disposition: 'attachment' },
    { extension: 'xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', type: 'excel', disposition: 'attachment' },
    { extension: 'xls', contentType: 'application/vnd.ms-excel', type: 'excel', disposition: 'attachment' },
    { extension: 'pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', type: 'powerpoint', disposition: 'attachment' },
    { extension: 'ppt', contentType: 'application/vnd.ms-powerpoint', type: 'powerpoint', disposition: 'attachment' },
    { extension: 'csv', contentType: 'text/csv', type: 'csv', disposition: 'attachment' },
    { extension: 'txt', contentType: 'text/plain', type: 'text', disposition: 'inline' },
];

/** The largest file the library takes: 20 MB. Images keep their own limit (Settings > Misc). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The Storage folder of library files, before the install's upload folder is added. */
export const MEDIA_FILES_FOLDER = 'mediaFiles';

/** The Font Awesome icon each type shows where there is no thumbnail. */
export const MEDIA_FILE_TYPE_ICONS: Record<MediaFileType, string> = {
    pdf: 'fa-solid fa-file-pdf',
    word: 'fa-solid fa-file-word',
    excel: 'fa-solid fa-file-excel',
    powerpoint: 'fa-solid fa-file-powerpoint',
    csv: 'fa-solid fa-file-csv',
    text: 'fa-solid fa-file-lines',
};

/** The extensions the file chooser offers, as an `accept` value. */
export const ALLOWED_FILE_ACCEPT = ALLOWED_FILES.map((f) => `.${f.extension}`).join(',');

/** A file's extension, lower case and without the dot; empty when it has none. */
export function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The table row for `name`, or null when the library does not take it. */
export function allowedFileOf(name: string): AllowedFile | null {
    const extension = extensionOf(name);
    return ALLOWED_FILES.find((f) => f.extension === extension) ?? null;
}

/** True when `name` is a document the Files tab takes (not an image). */
export function isLibraryDocument(name: string): boolean {
    return allowedFileOf(name) !== null;
}

/** True when `file` looks like a PDF, by name or by type. */
export function isPdfFile(file: { name: string; type?: string }): boolean {
    return extensionOf(file.name) === 'pdf' || file.type === 'application/pdf';
}

/**
 * The title a file starts with: its name without the extension, with dashes
 * and underscores as spaces. "Annual-Report_2025.pdf" is "Annual Report 2025".
 */
export function defaultTitle(name: string): string {
    const withoutExtension = name.replace(/\.[^/.]+$/, '');
    const title = withoutExtension.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return title || name;
}

/**
 * The `Content-Disposition` a file is stored with: open or download, under its
 * title. The title is the admin's, so quotes and line breaks are dropped and
 * non-ASCII characters go in the RFC 5987 form browsers read.
 */
export function contentDispositionFor(file: AllowedFile, title: string): string {
    const name = `${title.replace(/["\\\r\n]/g, '').trim() || 'file'}.${file.extension}`;
    const ascii = name.replace(/[^\x20-\x7e]/g, '_');
    return `${file.disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** A file name as the slug its stored name starts with. */
export function fileSlug(originalName: string): string {
    let slug = originalName
        .replace(/\.[^/.]+$/, '')
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    if (slug.length > 50) slug = slug.substring(0, 50).replace(/-$/, '');
    return slug || 'file';
}

/** A file's stored name: the title as a slug, a random part, and the extension. */
export function storedFileName(originalName: string, extension: string, random: string = Math.random().toString(36).substring(2, 8)): string {
    return `${fileSlug(originalName)}-${random}.${extension}`;
}

/**
 * Whether a file in the library is `file` uploaded before (PI-D4): the same
 * name, as its stored name keeps it, and the same size in bytes. Good enough
 * to stop the same brochure being stored twice; two different files with the
 * same name and the exact same size are not a real case.
 */
export function isSameUpload(stored: { name: string; bytes: number }, file: { name: string; size: number }): boolean {
    if (stored.bytes !== file.size) return false;
    const extension = extensionOf(file.name);
    if (!extension || extensionOf(stored.name) !== extension) return false;
    const stem = stored.name.replace(/-[a-z0-9]{1,8}\.[^.]+$/, '');
    return stem === fileSlug(file.name);
}
