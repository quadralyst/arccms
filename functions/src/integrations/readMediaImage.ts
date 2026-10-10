import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, storage } from '../init.js';
import { arcStorageBucket, arcStoragePrefix } from '../arc-config.js';
import { requireAdmin } from '../search/auth.js';

/** Larger than any XL file the uploader makes, and well inside a callable's 10 MB reply. */
export const MAX_MEDIA_READ_BYTES = 7 * 1024 * 1024;

/**
 * The Storage path of a media document's largest file: its XL size, else the
 * one file of an upload from before sizes existed (read from its download
 * URL). Null when neither is a media library file.
 */
export function mediaSourcePath(data: Record<string, any> | undefined, prefix: string = arcStoragePrefix()): string | null {
    if (!data) return null;
    let path: unknown = data.variants?.xl?.path;
    if (typeof path !== 'string' || !path) {
        const match = typeof data.downloadURL === 'string' ? /\/o\/([^?#]+)/.exec(data.downloadURL) : null;
        if (!match) return null;
        try {
            path = decodeURIComponent(match[1]);
        } catch {
            return null;
        }
    }
    const value = path as string;
    if (!value.startsWith(`${prefix}mediaImages/`) || value.includes('..')) return null;
    if (value.slice(`${prefix}mediaImages/`.length).includes('/')) return null;
    return value;
}

/**
 * Callable: readMediaImage
 *
 * Returns the bytes of a media library image so the media manager can crop it
 * in the browser. A canvas may only export an image its page is allowed to
 * read, and a Storage bucket sends no cross-origin header unless it was given
 * a CORS setup; reading through here needs none.
 *
 * Input:  { mediaId: string }
 * Output: { data: base64 string, contentType: string }
 *
 * Admins only, and only the media document's own file (never a path the
 * caller names). GIFs are refused: cropping would drop their animation.
 */
export const readMediaImage = onCall(async (request) => {
    await requireAdmin(request);

    const mediaId = request.data?.mediaId;
    if (typeof mediaId !== 'string' || !mediaId || mediaId.includes('/')) {
        throw new HttpsError('invalid-argument', 'A media id is required.');
    }

    const snap = await db.collection('media').doc(mediaId).get();
    if (!snap.exists) {
        throw new HttpsError('not-found', 'That image is no longer in the media library.');
    }

    const path = mediaSourcePath(snap.data());
    if (!path) {
        throw new HttpsError('failed-precondition', 'That image is not a media library file.');
    }
    if (/\.gif$/i.test(path)) {
        throw new HttpsError('failed-precondition', 'GIFs cannot be cropped: cropping would drop the animation.');
    }

    const bucketName = arcStorageBucket();
    const file = (bucketName ? storage.bucket(bucketName) : storage.bucket()).file(path);
    const [metadata] = await file.getMetadata().catch(() => {
        throw new HttpsError('not-found', 'The image file is missing from Storage.');
    });
    if (Number(metadata.size) > MAX_MEDIA_READ_BYTES) {
        throw new HttpsError('failed-precondition', 'The image is too large to crop here.');
    }

    const [buffer] = await file.download();
    return {
        data: buffer.toString('base64'),
        contentType: typeof metadata.contentType === 'string' ? metadata.contentType : 'image/webp',
    };
});
