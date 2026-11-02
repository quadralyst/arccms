/**
 * Admin: one file a model made, or one kept with a call's record, as base64 (Settings, AI,
 * Calls; specs/ai-media-spec.md, AM-D22, AM-D27). Read with the functions' rights, so the
 * bucket's CORS setup does not matter: from Arc's AI folders, or a file a call saved in the
 * app's own folder, which its record names. A callable answers at most about 10 MB, so a
 * larger file is refused with a message.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { arcStorageBucket } from '../../arc-config.js';
import { db, storage } from '../../init.js';
import { requireAdmin } from '../../search/auth.js';
import { isAiFilePath } from '../paths.js';

export const MAX_READ_BYTES = 7 * 1024 * 1024;

function bucket() {
    const name = arcStorageBucket();
    return name ? storage.bucket(name) : storage.bucket();
}

export const readAiFile = onCall({ timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
    await requireAdmin(request);
    const path = request.data?.path;
    if (typeof path !== 'string' || !path || path.length > 400 || path.split('/').some((s) => s === '..' || s === '.' || s === '')) {
        throw new HttpsError('invalid-argument', 'Name a file a call made.');
    }
    // Outside Arc's AI folders, only a file a call's record names: never any file in the bucket.
    if (!isAiFilePath(path)) {
        const named = await db.collection('AiCalls').where('filePaths', 'array-contains', path).limit(1).get();
        if (named.empty) throw new HttpsError('permission-denied', 'That file is not one a call made.');
    }
    const file = bucket().file(path);
    let size: number;
    let contentType: string;
    try {
        const [meta] = await file.getMetadata();
        size = Number(meta.size ?? 0);
        contentType = String(meta.contentType ?? 'application/octet-stream');
    } catch {
        throw new HttpsError('not-found', 'That file was moved or deleted.');
    }
    if (size > MAX_READ_BYTES) throw new HttpsError('failed-precondition', `That file is ${Math.round(size / 1048576)} MB; open it from Storage in the Firebase console.`);
    const [bytes] = await file.download();
    return { data: bytes.toString('base64'), contentType, bytes: size };
});
