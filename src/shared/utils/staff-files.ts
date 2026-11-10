/**
 * The files the admin tools may put in the bucket outside the library's Files
 * (docs/features/data.html, Import Files): images, PDF, video, audio, fonts and plain
 * data, each extension with the one content type it is stored with.
 *
 * The storage rules (storage.rules, `isStaffFileType`) take exactly these types; a
 * rules test uploads each one. The type comes from the extension, never the browser's
 * guess, so a font or a CSV the browser cannot name is still stored as what it is.
 *
 * Never HTML, SVG, scripts or archives: the bucket is public, so a file there can be
 * opened as a page. An SVG can carry a script, and the bucket serves it as an image
 * that a browser runs when it is opened on its own, so SVG stays out.
 */
import { extensionOf } from './media-files';

export const STAFF_FILE_TYPES: Readonly<Record<string, string>> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
};

/** The content type a staff upload of this file is stored with, or null when the bucket refuses it. */
export function staffFileType(name: string): string | null {
    return STAFF_FILE_TYPES[extensionOf(name)] ?? null;
}
