/**
 * The record of each askAi call (specs/ai-spec.md, AI-D11, AI-D12): `AiCalls/{id}`, kept 60
 * days. It says what was asked of which model, how it went, the tokens and the cost, but
 * not what was asked or answered, unless the purpose's switch keeps the content: then the
 * instruction, the text and the answer are on the record, and each file is copied beside
 * it in Storage, since the app may delete its own copy once read. Admins read records;
 * nothing writes them from a browser.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { arcStorageBucket, arcStoragePrefix } from '../arc-config.js';
import { db, storage } from '../init.js';
import type { PreparedPart } from './input.js';
import type { AiFailureReason, AiFile, AiImageSettings, AiKind, AiTier, AiUnit } from './types.js';

export const AI_CALLS = 'AiCalls';
export const AI_CALL_FILES_FOLDER = 'ai-calls';
export const KEEP_DAYS = 60;
/**
 * The most characters a record keeps of the instruction, the text and the answer together,
 * in that order: well under Firestore's 1 MB a document even for three-byte characters.
 */
export const MAX_KEPT_CHARS = 250_000;

export interface AttemptRecord {
    connection: string;
    model: string;
    outcome: 'ok' | string;
    ms: number;
    detail?: string;
}

export interface AiCallRecord {
    purpose: string;
    /** What the purpose makes (specs/ai-media-spec.md, AM-D27). */
    kind: AiKind;
    tier: AiTier;
    test: boolean;
    ref: string | null;
    limitKey: string | null;
    units: number;
    input: { chars: number; files: number; bytes: number };
    attempts: AttemptRecord[];
    connection: string | null;
    model: string | null;
    tokensIn: number;
    tokensOut: number;
    tokensThinking: number;
    /** Input tokens read from, and written to, the provider's cache (AM-D31). */
    tokensCached: number;
    tokensCacheWrite: number;
    /** What was billed, in `unit` (AM-D27). */
    amount: number;
    unit: AiUnit;
    costUsd: number;
    /** Where the cost came from: the provider's own figure, the price list, or none (no price, a test). */
    costFrom: 'provider' | 'price-list' | 'none';
    ms: number;
    outcome: 'ok' | AiFailureReason;
    scope?: 'key' | 'budget';
    detail?: string;
    /** The files a file kind made, and their paths apart, so moveAiFile can find the record. */
    files?: AiFile[];
    filePaths?: string[];
    /** Answered from Arc's own cache (AM-D16), with the record of the call that made the files. */
    cached?: boolean;
    cachedFrom?: string | null;
    /** Speech: the voice asked for by name, and the provider's id of the one that spoke (AM-D17). */
    voice?: string | null;
    voiceId?: string | null;
    /** Pictures: the settings the model was asked with, after fitting them to it (AM-D19). */
    image?: AiImageSettings;
}

export interface KeptContent {
    instruction: string;
    parts: PreparedPart[];
    answer: string | null;
}

/** The Storage folder of one record's files. */
export function aiCallFolder(id: string): string {
    return `${arcStoragePrefix()}${AI_CALL_FILES_FOLDER}/${id}/`;
}

function bucket() {
    const name = arcStorageBucket();
    return name ? storage.bucket(name) : storage.bucket();
}

function safeName(name: string | null, i: number, mimeType: string): string {
    const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[1] ?? 'bin';
    const base = (name ?? `part-${i + 1}`).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || `part-${i + 1}`;
    return base.includes('.') ? base : `${base}.${ext}`;
}

/** Takes characters from one budget, so the kept texts together stay under MAX_KEPT_CHARS. */
function charBudget() {
    let left = MAX_KEPT_CHARS;
    return (text: string): string => {
        const kept = text.slice(0, Math.max(0, left));
        left -= kept.length;
        return kept;
    };
}

async function keepFiles(id: string, parts: PreparedPart[], take: (t: string) => string): Promise<Array<Record<string, unknown>>> {
    const folder = aiCallFolder(id);
    return Promise.all(parts.map(async (part, i) => {
        if (part.kind === 'text') return { kind: 'text', text: take(part.text) };
        const path = `${folder}${i + 1}-${safeName(part.name, i, part.mimeType)}`;
        await bucket().file(path).save(part.bytes, { contentType: part.mimeType, resumable: false });
        return { kind: part.kind, mimeType: part.mimeType, size: part.bytes.length, path, from: part.storagePath };
    }));
}

/** A new record's id, for a call that must name its files before the record is written. */
export function newAiCallId(): string {
    return db.collection(AI_CALLS).doc().id;
}

/** Where a record's kept content is: a document of its own, so listing records never loads it. */
export function contentDoc(id: string) {
    return db.collection(AI_CALLS).doc(id).collection('content').doc('main');
}

/**
 * Write the record, and its content apart when the purpose keeps it. Never throws: the app's
 * answer must not be lost over its record, so a failure is logged and the id comes back null.
 */
export async function writeAiCall(record: AiCallRecord, content: KeptContent | null, now = new Date(), id?: string): Promise<string | null> {
    const ref = id ? db.collection(AI_CALLS).doc(id) : db.collection(AI_CALLS).doc();
    try {
        const doc: Record<string, unknown> = {
            ...record,
            createdAt: Timestamp.fromDate(now),
            ...(content ? { hasContent: true } : {}),
        };
        for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
        await ref.set(doc);
        if (content) {
            const take = charBudget();
            const instruction = take(content.instruction);
            let parts: Array<Record<string, unknown>>;
            try {
                parts = await keepFiles(ref.id, content.parts, take);
            } catch (err) {
                console.error(`askAi: the files of record ${ref.id} were not kept`, err);
                const again = charBudget();
                again(instruction);
                parts = content.parts.map((p) => (p.kind === 'text' ? { kind: 'text', text: again(p.text) } : { kind: p.kind, mimeType: p.mimeType, size: p.bytes.length, path: null, from: p.storagePath }));
            }
            try {
                await contentDoc(ref.id).set({ instruction, parts, answer: content.answer === null ? null : take(content.answer) });
            } catch (err) {
                // The record matters more than its content: it stays, marked.
                console.error(`askAi: the content of record ${ref.id} was not kept`, err);
                await ref.update({ contentDropped: true });
            }
        }
        return ref.id;
    } catch (err) {
        console.error(`askAi: the record of a ${record.purpose} call was not written`, err);
        return null;
    }
}
