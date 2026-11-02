/**
 * Files a model made (specs/ai-media-spec.md, AM-D9, AM-D10, AM-D11): saved to the install's
 * bucket, never returned as bytes. By default in Arc's private `ai-files/{purpose}/{month}/`;
 * with the purpose's `saveTo`, in the app's own folder, at the call's `saveAs` when it gives
 * one. Test files always go to `ai-files/_test/`, so they never land among real ones, and
 * are deleted after a day. The app moves a file with `moveAiFile`, which keeps the call's
 * record pointing at it.
 */
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { FieldValue } from 'firebase-admin/firestore';
import { arcStorageBucket, arcStoragePrefix } from '../arc-config.js';
import { db, storage } from '../init.js';
import type { MadeFile } from './connectors/types.js';
import { AI_FILES_FOLDER, aiFilesFolder, aiPurposeFolder, extensionFor, storagePathProblem } from './paths.js';
import { safeBaseUrl } from './settings.js';
import type { AiFile } from './types.js';

export const AI_CACHE = 'AiCache';
/** Test files are kept a day (AM-D11). */
export const TEST_FILE_DAYS = 1;

function bucket() {
    const name = arcStorageBucket();
    return name ? storage.bucket(name) : storage.bucket();
}

/** Where test files go: apart from real ones, by purpose and month. */
export function testFilesFolder(purpose: string, month: string): string {
    return `${arcStoragePrefix()}${AI_FILES_FOLDER}/_test/${purpose}/${month}/`;
}

/** `a/b.mp3` as the nth file of a call: `a/b.mp3`, `a/b-2.mp3`, `a/b-3.mp3`. */
export function nthPath(path: string, n: number): string {
    if (n === 1) return path;
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    return dot > slash ? `${path.slice(0, dot)}-${n}${path.slice(dot)}` : `${path}-${n}`;
}

/** The paths a call's files go to. */
export function filePaths(options: { recordId: string; purpose: string; month: string; test: boolean; saveTo?: string; saveAs?: string; files: Array<Pick<MadeFile, 'mimeType'>> }): string[] {
    const { recordId, purpose, month, test, saveTo, saveAs, files } = options;
    return files.map((f, i) => {
        const name = `${recordId}-${i + 1}.${extensionFor(f.mimeType)}`;
        if (test) return `${testFilesFolder(purpose, month)}${name}`;
        if (saveTo && saveAs) return nthPath(saveAs, i + 1);
        if (saveTo) return `${saveTo.replace(/\/+$/, '')}/${name}`;
        return `${aiFilesFolder(purpose, month)}${name}`;
    });
}

/** Save the files and say where they are. */
export async function saveFiles(paths: string[], files: MadeFile[], meta: { recordId: string; purpose: string; test: boolean }): Promise<AiFile[]> {
    return Promise.all(files.map(async (f, i) => {
        await bucket().file(paths[i]).save(f.bytes, {
            contentType: f.mimeType,
            resumable: false,
            metadata: { metadata: { aiRecord: meta.recordId, aiPurpose: meta.purpose, ...(meta.test ? { aiTest: 'true' } : {}) } },
        });
        const file: AiFile = { path: paths[i], mimeType: f.mimeType, bytes: f.bytes.length };
        if (f.width) file.width = f.width;
        if (f.height) file.height = f.height;
        if (f.seconds) file.seconds = f.seconds;
        return file;
    }));
}

/** Whether a file is still in the bucket. */
export async function fileExists(path: string): Promise<boolean> {
    try {
        const [exists] = await bucket().file(path).exists();
        return exists;
    } catch {
        return false;
    }
}

/** A saved file's type and size, from Storage. */
export async function describeFile(path: string): Promise<{ mimeType: string; bytes: number }> {
    const [meta] = await bucket().file(path).getMetadata();
    return { mimeType: String(meta.contentType ?? 'application/octet-stream'), bytes: Number(meta.size ?? 0) };
}

/** Where the cache keeps its own copy of a file, apart from where any call put it (AM-D16). */
export function cacheFilePath(purpose: string, hash: string, n: number, mimeType: string): string {
    return `${arcStoragePrefix()}${AI_FILES_FOLDER}/_cache/${purpose}/${hash}-${n}.${extensionFor(mimeType)}`;
}

/** Delete files, ignoring any already gone. Never throws. */
export async function deleteFiles(paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => bucket().file(p).delete({ ignoreNotFound: true }).catch((err: unknown) => console.error(`ai: ${p} not deleted`, err))));
}

/** Copy a file inside the bucket, as the cache does (AM-D16). */
export async function copyFile(from: string, to: string): Promise<void> {
    await bucket().file(from).copy(bucket().file(to));
}

/**
 * Move a file a call made to where the app keeps it, and point the call's record at the new
 * place (AM-D10). `from` must be a file a call made: in Arc's `ai-files/` (not a test file)
 * or named by a call's record. `to` is in the install's bucket, not in Arc's own folders,
 * and not a file that is already there. Returns the new path.
 */
export async function moveAiFile(from: string, to: string): Promise<string> {
    const plain = typeof from === 'string' && !!from && !from.startsWith('/') && !from.includes('\\') && !from.split('/').some((s) => s === '' || s === '.' || s === '..');
    if (!plain) throw new Error('moveAiFile: from must be a plain path in the project\'s bucket.');
    const own = `${arcStoragePrefix()}${AI_FILES_FOLDER}/`;
    if (from.startsWith(`${own}_test/`) || from.startsWith(`${own}_cache/`)) throw new Error('moveAiFile: test files and the cache\'s own copies stay where they are.');
    const toProblem = storagePathProblem(to, 'to');
    if (toProblem) throw new Error(`moveAiFile: ${toProblem}.`);
    const records = await db.collection('AiCalls').where('filePaths', 'array-contains', from).limit(100).get();
    // Only a file a call made: never any other file in the bucket, such as a person's own.
    if (!from.startsWith(own) && records.empty) throw new Error(`moveAiFile: ${from} is not a file a call made.`);
    const [exists] = await bucket().file(to).exists();
    if (exists) throw new Error(`moveAiFile: ${to} is already there; move it away or choose another path.`);
    await bucket().file(from).move(to);
    await Promise.all(records.docs.map((d) => {
        const files = ((d.data()['files'] ?? []) as AiFile[]).map((f) => (f.path === from ? { ...f, path: to } : f));
        return d.ref.update({ files, filePaths: files.map((f) => f.path), movedAt: FieldValue.serverTimestamp() });
    }));
    return to;
}

/** Delete one purpose's files in `ai-files/` older than its days (AM-D10), and every test file older than a day. */
export async function purgeAiFiles(daysByPurpose: Record<string, number>, now = new Date()): Promise<number> {
    let deleted = 0;
    const folders: Array<{ prefix: string; days: number }> = [
        { prefix: `${arcStoragePrefix()}${AI_FILES_FOLDER}/_test/`, days: TEST_FILE_DAYS },
        ...Object.entries(daysByPurpose).filter(([, d]) => d > 0).map(([p, days]) => ({ prefix: aiPurposeFolder(p), days })),
    ];
    for (const { prefix, days } of folders) {
        const cutoff = now.getTime() - days * 86_400_000;
        const [files] = await bucket().getFiles({ prefix });
        const old = files.filter((f) => {
            const created = Date.parse(String(f.metadata?.timeCreated ?? ''));
            return Number.isFinite(created) && created < cutoff;
        });
        await Promise.all(old.map((f) => f.delete({ ignoreNotFound: true }).catch((err: unknown) => console.error(`cleanUpAi: ${f.name} not deleted`, err))));
        deleted += old.length;
    }
    return deleted;
}

/** The most a video Arc fetches from a provider may be. */
export const MAX_STREAM_BYTES = 500 * 1024 * 1024;

/**
 * Stream a file a provider made, from the address in its answer, straight into the bucket
 * (AM-D12, AM-D28): never held in memory, https only, a host the preset lists (and a public
 * one) on every hop of at most three redirects, never with the key, and stopped at the cap.
 */
export async function streamToStorage(url: string, hosts: readonly string[], path: string, meta: { contentType: string; recordId: string; purpose: string }, timeoutMs: number, maxBytes = MAX_STREAM_BYTES): Promise<{ ok: true; bytes: number; contentType: string } | { ok: false; failure: 'unreadable' | 'unavailable' | 'timeout' | 'too-large'; detail: string }> {
    const allowed = (u: string) => {
        let parsed: URL;
        try {
            parsed = new URL(u);
        } catch {
            return false;
        }
        const host = parsed.hostname.toLowerCase();
        return parsed.protocol === 'https:' && !parsed.username && !parsed.password && safeBaseUrl(`${parsed.protocol}//${parsed.host}`)
            && hosts.some((h) => host === h.replace(/^\./, '') || (h.startsWith('.') && host.endsWith(h)));
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
        let current = url;
        for (let hop = 0; hop < 4; hop++) {
            if (!allowed(current)) return { ok: false, failure: 'unreadable', detail: 'the provider gave a file address Arc does not fetch from' };
            const response = await fetch(current, { signal: controller.signal, redirect: 'manual' });
            if (response.status >= 300 && response.status < 400) {
                const next = response.headers.get('location');
                if (!next) return { ok: false, failure: 'unreadable', detail: 'the provider\'s file address redirected nowhere' };
                current = new URL(next, current).toString();
                continue;
            }
            if (response.status !== 200 || !response.body) return { ok: false, failure: response.status >= 500 ? 'unavailable' : 'unreadable', detail: `the provider's file could not be fetched (${response.status})` };
            const length = Number(response.headers.get('content-length'));
            if (Number.isFinite(length) && length > maxBytes) return { ok: false, failure: 'too-large', detail: `the provider's file is larger than Arc fetches (${Math.round(length / 1048576)} MB)` };
            const contentType = (response.headers.get('content-type') || meta.contentType).split(';')[0].trim();
            let size = 0;
            const counter = new Transform({
                transform(chunk: Buffer, _enc, done) {
                    size += chunk.length;
                    done(size > maxBytes ? new Error('too-large') : null, chunk);
                },
            });
            const out = bucket().file(path).createWriteStream({ resumable: false, contentType, metadata: { metadata: { aiRecord: meta.recordId, aiPurpose: meta.purpose } } });
            try {
                await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream), counter, out);
            } catch (err) {
                await deleteFiles([path]);
                if (String((err as Error).message) === 'too-large') return { ok: false, failure: 'too-large', detail: 'the provider\'s file is larger than Arc fetches' };
                throw err;
            }
            return { ok: true, bytes: size, contentType };
        }
        return { ok: false, failure: 'unreadable', detail: 'the provider\'s file address redirected too many times' };
    } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return { ok: false, failure: 'timeout', detail: 'the provider\'s file did not come in time' };
        return { ok: false, failure: 'unavailable', detail: `the provider's file could not be fetched: ${String((err as Error).message ?? err).slice(0, 160)}` };
    } finally {
        clearTimeout(timer);
    }
}

/** A file in the bucket as bytes, with its type, refusing one larger than `maxBytes`. */
export async function readBucketFile(path: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string } | { tooLarge: number } | null> {
    const file = bucket().file(path);
    let size: number;
    let contentType: string;
    try {
        const [meta] = await file.getMetadata();
        size = Number(meta.size ?? 0);
        contentType = String(meta.contentType ?? 'application/octet-stream');
    } catch {
        return null;
    }
    if (size > maxBytes) return { tooLarge: size };
    const [bytes] = await file.download();
    return { bytes, contentType };
}
