/**
 * Arc's own cache for files (specs/ai-media-spec.md, AM-D16): a purpose with `cache` gives
 * the same input the same file, with no provider call. A hit counts against nothing (no
 * budget, no allowance, no call in Usage) and leaves a record marked `cached`.
 *
 * The cache keeps its own copy of each file in `ai-files/_cache/{purpose}/`, apart from
 * where any call put it, so a call that moves or deletes its file never takes it from the
 * next; a hit is copied to where that call wants it. `AiCache/{hash}`: the copies' paths,
 * what each file is, the record that made them, the model, when it ends. No browser reads
 * it. The hash is of everything that changes the file: the purpose, the model, the
 * settings, the text and the input files' bytes. A hit whose copy is gone is a miss, and
 * the new file takes its place.
 */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { PreparedPart } from './input.js';
import { AI_CACHE, cacheFilePath, copyFile, deleteFiles, fileExists } from './files.js';
import type { AiModelRef } from './settings.js';
import type { AiFile } from './types.js';

export interface CacheEntry {
    hash: string;
    /** The cache's own copies. */
    paths: string[];
    /** What each file is: its type, size and shape, as a fresh answer gives them. */
    files: Array<Omit<AiFile, 'path'>>;
    recordId: string | null;
    connection: string;
    model: string;
}

/** A stable JSON text: keys sorted, so the same settings always hash the same. */
function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value as Record<string, unknown>).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

/** The cache key of one call on one model. */
export function cacheHash(purpose: string, ref: AiModelRef, settings: unknown, instruction: string, parts: PreparedPart[]): string {
    const hash = createHash('sha256');
    hash.update(stable({ purpose, connection: ref.connection, model: ref.model, settings, instruction }));
    for (const part of parts) {
        if (part.kind === 'text') hash.update(`\u0000t${part.text}`);
        else hash.update(`\u0000f${part.mimeType}\u0000`).update(part.bytes);
    }
    return hash.digest('hex').slice(0, 40);
}

/**
 * The first live entry among the hashes, in the order given (the purpose's model list), whose
 * files are all still there; null when none is.
 */
export async function findCached(hashes: Array<{ hash: string; ref: AiModelRef }>, now = new Date()): Promise<CacheEntry | null> {
    if (!hashes.length) return null;
    const snaps = await db.getAll(...hashes.map((h) => db.collection(AI_CACHE).doc(h.hash)));
    for (const [i, snap] of snaps.entries()) {
        if (!snap.exists) continue;
        const d = snap.data() ?? {};
        const ends = d['expiresAt'] instanceof Timestamp ? d['expiresAt'].toMillis() : 0;
        const paths = Array.isArray(d['paths']) ? (d['paths'] as string[]) : [];
        const files = Array.isArray(d['files']) ? (d['files'] as CacheEntry['files']) : [];
        if (ends <= now.getTime() || !paths.length || files.length !== paths.length) continue;
        const there = await Promise.all(paths.map((p) => fileExists(p)));
        if (there.every(Boolean)) {
            return { hash: hashes[i].hash, paths, files, recordId: typeof d['recordId'] === 'string' ? d['recordId'] : null, connection: hashes[i].ref.connection, model: hashes[i].ref.model };
        }
    }
    return null;
}

/**
 * Keep a copy of a live call's files for later hits. Never throws: the answer matters more,
 * and a file the cache could not copy is simply not cached.
 */
export async function storeCached(entry: { hash: string; files: AiFile[]; recordId: string | null; connection: string; model: string; purpose: string; days: number }, now = new Date()): Promise<void> {
    try {
        const paths = entry.files.map((f, i) => cacheFilePath(entry.purpose, entry.hash, i + 1, f.mimeType));
        await Promise.all(entry.files.map((f, i) => copyFile(f.path, paths[i])));
        await db.collection(AI_CACHE).doc(entry.hash).set({
            purpose: entry.purpose,
            paths,
            files: entry.files.map(({ path: _path, ...rest }) => rest),
            recordId: entry.recordId,
            connection: entry.connection,
            model: entry.model,
            createdAt: Timestamp.fromDate(now),
            expiresAt: Timestamp.fromMillis(now.getTime() + entry.days * 86_400_000),
        });
    } catch (err) {
        console.error(`askAi: the cache entry of a ${entry.purpose} call was not kept`, err);
    }
}

/** Delete cache entries past their days, with the cache's own copies of their files. */
export async function purgeAiCache(now = new Date()): Promise<number> {
    let deleted = 0;
    for (;;) {
        const snap = await db.collection(AI_CACHE).where('expiresAt', '<', Timestamp.fromDate(now)).limit(300).get();
        if (snap.empty) break;
        await deleteFiles(snap.docs.flatMap((d) => (Array.isArray(d.data()['paths']) ? (d.data()['paths'] as string[]) : [])));
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < 300) break;
    }
    return deleted;
}
