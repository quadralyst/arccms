import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, storage } from '../init.js';
import { arcStorageBucket, arcStoragePrefix } from '../arc-config.js';
import { requireAdmin } from '../search/auth.js';

/** The largest library file (src/shared/utils/media-files.ts, MAX_FILE_BYTES). */
export const MAX_MEDIA_FILE_BYTES = 20 * 1024 * 1024;

/**
 * One part of a file per call. A callable's reply holds about 10 MB and base64
 * adds a third, so 6 MB of file is about 8 MB of reply (MF-D16).
 */
export const MEDIA_FILE_PART_BYTES = 6 * 1024 * 1024;

/**
 * The Storage path of a `mediaFiles` document's PDF, or null when the record
 * does not point straight into the library folder.
 */
export function mediaFilePath(data: Record<string, any> | undefined, prefix: string = arcStoragePrefix()): string | null {
    const path = data?.path;
    if (typeof path !== 'string' || !path) return null;
    const folder = `${prefix}mediaFiles/`;
    if (!path.startsWith(folder) || path.includes('..')) return null;
    const name = path.slice(folder.length);
    if (!name || name.includes('/')) return null;
    return path;
}

/**
 * Callable: readMediaFile
 *
 * Returns one part of a library PDF, so the media manager can draw its pages
 * in the browser and take an image from one (docs/features/media.html, Take
 * an image from a PDF). pdf.js needs the bytes, and a Storage bucket sends no
 * cross-origin header unless it was given a CORS setup; reading through here
 * needs none. The browser asks for parts until it has `total` bytes.
 *
 * Input:  { fileId: string, offset?: number }
 * Output: { data: base64 string, offset: number, total: number }
 *
 * Admins only, PDFs only, and only the `mediaFiles` document's own file
 * (never a path the caller names).
 */
export const readMediaFile = onCall(async (request) => {
    await requireAdmin(request);

    const fileId = request.data?.fileId;
    if (typeof fileId !== 'string' || !fileId || fileId.includes('/')) {
        throw new HttpsError('invalid-argument', 'A file id is required.');
    }
    const offset = request.data?.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset % MEDIA_FILE_PART_BYTES !== 0) {
        throw new HttpsError('invalid-argument', 'The offset must be the start of a part.');
    }

    const snap = await db.collection('mediaFiles').doc(fileId).get();
    if (!snap.exists) {
        throw new HttpsError('not-found', 'That file is no longer in the media library.');
    }
    const record = snap.data();
    const path = mediaFilePath(record);
    if (!path) {
        throw new HttpsError('failed-precondition', 'That file is not a media library file.');
    }
    if (record?.type !== 'pdf' || !/\.pdf$/i.test(path)) {
        throw new HttpsError('failed-precondition', 'Only PDFs can be read here.');
    }

    const bucketName = arcStorageBucket();
    const file = (bucketName ? storage.bucket(bucketName) : storage.bucket()).file(path);
    const [metadata] = await file.getMetadata().catch(() => {
        throw new HttpsError('not-found', 'The file is missing from Storage.');
    });
    const total = Number(metadata.size);
    if (!Number.isFinite(total) || total > MAX_MEDIA_FILE_BYTES) {
        throw new HttpsError('failed-precondition', 'The file is too large to read here.');
    }
    if (offset > 0 && offset >= total) {
        throw new HttpsError('invalid-argument', 'The offset is past the end of the file.');
    }

    if (total === 0) return { data: '', offset: 0, total: 0 };
    const end = Math.min(offset + MEDIA_FILE_PART_BYTES, total) - 1;
    const [buffer] = await file.download({ start: offset, end });
    return { data: buffer.toString('base64'), offset, total };
});
