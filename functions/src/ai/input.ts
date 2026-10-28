/**
 * A call's input, checked and made ready to send (specs/ai-spec.md, AI-D9, AI-D19): text,
 * pictures and PDFs, from text, bytes or the install's Storage bucket. A developer's
 * mistake (a kind the purpose does not take, a wrong type, a path outside the bucket)
 * throws; what a person can cause (a file too large, one that is missing or is not what
 * it says) comes back as a reason.
 */
import { arcStorageBucket } from '../arc-config.js';
import { storage } from '../init.js';
import { DEFAULT_TEXT_CHARS } from './purposes.js';
import type { AiInputPart, AiPurpose, AiFailureReason } from './types.js';

export type PreparedPart =
    | { kind: 'text'; text: string }
    | { kind: 'picture' | 'pdf'; mimeType: string; bytes: Buffer; name: string | null; storagePath: string | null };

/** At most this much in one request, all parts together: what providers take inline. */
export const MAX_REQUEST_BYTES = 20 * 1024 * 1024;

const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PDF_TYPE = 'application/pdf';

export type PreparedInput =
    | { ok: true; parts: PreparedPart[]; chars: number; files: number; bytes: number }
    | { ok: false; reason: AiFailureReason; detail: string; chars: number; files: number; bytes: number };

function fail(message: string): never {
    throw new Error(`askAi: ${message}`);
}

/** The type the bytes really are, from their first bytes; null when not a picture or PDF Arc reads. */
export function sniffType(bytes: Buffer): string | null {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return PDF_TYPE;
    return null;
}

/** A Storage path askAi may read: in the install's bucket, relative, without `..` (AI-D19). */
export function checkedStoragePath(path: unknown): string {
    if (typeof path !== 'string' || !path.trim()) fail('storagePath must be a path in the project\'s bucket, such as app/menus/b1/p1.jpg.');
    let p = path.trim();
    const bucket = arcStorageBucket();
    if (p.startsWith('gs://')) {
        const rest = p.slice(5);
        const slash = rest.indexOf('/');
        const name = slash < 0 ? rest : rest.slice(0, slash);
        if (!bucket || name !== bucket) fail(`storagePath ${p} is not in the project's bucket; pass the path inside the bucket.`);
        p = slash < 0 ? '' : rest.slice(slash + 1);
    }
    if (!p || p.startsWith('/') || p.split('/').some((s) => s === '..' || s === '.' || s === '') || p.includes('\\')) {
        fail(`storagePath "${path}" must be a plain path inside the bucket, without /, . or .. parts.`);
    }
    return p;
}

function bucket() {
    const name = arcStorageBucket();
    return name ? storage.bucket(name) : storage.bucket();
}

function asList(input: AskInput): AiInputPart[] {
    if (input === undefined) return [];
    return Array.isArray(input) ? input : [input];
}

type AskInput = AiInputPart | AiInputPart[] | undefined;

interface FileSource {
    bytes?: Buffer;
    storagePath?: string;
    mimeType?: string;
    name: string | null;
}

/**
 * Check the input against the purpose and read what it names. Storage files are measured
 * before they are read, so a file too large is never downloaded.
 */
export async function prepareInput(purposeId: string, purpose: AiPurpose, input: AskInput, options: { readStorage?: boolean } = {}): Promise<PreparedInput> {
    const readStorage = options.readStorage !== false;
    const list = asList(input);
    const maxChars = purpose.input?.text?.maxChars ?? DEFAULT_TEXT_CHARS;
    const texts: Array<{ index: number; text: string }> = [];
    const files: Array<{ index: number; source: FileSource }> = [];
    list.forEach((part, index) => {
        if (typeof part === 'string') texts.push({ index, text: part });
        else if (typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string') texts.push({ index, text: part.text });
        else if (typeof part === 'object' && part !== null && 'storagePath' in part) {
            files.push({ index, source: { storagePath: checkedStoragePath(part.storagePath), mimeType: part.mimeType, name: null } });
        } else if (typeof part === 'object' && part !== null && 'bytes' in part) {
            if (!ArrayBuffer.isView(part.bytes)) fail('bytes must be a Buffer or a Uint8Array.');
            if (typeof part.mimeType !== 'string') fail('a part with bytes needs its mimeType, such as image/jpeg.');
            const b = part.bytes as Uint8Array;
            files.push({ index, source: { bytes: Buffer.from(b.buffer, b.byteOffset, b.byteLength), mimeType: part.mimeType, name: typeof part.name === 'string' ? part.name.slice(0, 120) : null } });
        } else {
            fail(`input part ${index + 1} must be text, { text }, { storagePath } or { bytes, mimeType }.`);
        }
    });

    const chars = texts.reduce((n, t) => n + t.text.length, 0);
    const counts = { chars, files: files.length, bytes: 0 };
    const refuse = (reason: AiFailureReason, detail: string): PreparedInput => ({ ok: false, reason, detail, ...counts });
    if (chars > maxChars) return refuse('too-large', `the text is ${chars} characters; ${purposeId} takes at most ${maxChars}`);

    // The kind a file says it is decides which limit it counts against; the bytes are
    // checked against it once read.
    const declared = (s: FileSource): 'picture' | 'pdf' | null => {
        const type = (s.mimeType ?? guessFromPath(s.storagePath)).toLowerCase();
        if (PICTURE_TYPES.includes(type)) return 'picture';
        if (type === PDF_TYPE) return 'pdf';
        return null;
    };
    const kinds = files.map((f) => {
        const kind = declared(f.source);
        if (!kind) fail(`input part ${f.index + 1} is ${f.source.mimeType ?? 'of an unknown type'}; askAi reads JPEG, PNG, WebP and PDF.`);
        const limit = kind === 'picture' ? purpose.input?.pictures : purpose.input?.pdfs;
        if (!limit) fail(`purpose ${purposeId} takes no ${kind === 'picture' ? 'pictures' : 'PDFs'}; add input.${kind === 'picture' ? 'pictures' : 'pdfs'} to it in functions/src/custom/ai.ts.`);
        return kind;
    });
    for (const kind of ['picture', 'pdf'] as const) {
        const limit = kind === 'picture' ? purpose.input?.pictures : purpose.input?.pdfs;
        const n = kinds.filter((k) => k === kind).length;
        if (limit && n > limit.max) return refuse('too-large', `${n} ${kind === 'picture' ? 'pictures' : 'PDFs'}; ${purposeId} takes at most ${limit.max}`);
    }

    const parts: PreparedPart[] = [];
    const prepared: Array<{ index: number; part: PreparedPart }> = texts.map((t) => ({ index: t.index, part: { kind: 'text', text: t.text } }));
    for (const [i, f] of files.entries()) {
        const kind = kinds[i];
        const limit = (kind === 'picture' ? purpose.input?.pictures : purpose.input?.pdfs)!;
        const maxBytes = Math.floor(limit.maxMb * 1024 * 1024);
        let bytes = f.source.bytes;
        if (!bytes && !readStorage) {
            // captureAiAsks: a unit test has no Storage; the path is recorded as given.
            prepared.push({ index: f.index, part: { kind, mimeType: f.source.mimeType ?? guessFromPath(f.source.storagePath), bytes: Buffer.alloc(0), name: null, storagePath: f.source.storagePath ?? null } });
            continue;
        }
        if (!bytes) {
            const file = bucket().file(f.source.storagePath!);
            let size: number;
            try {
                const [meta] = await file.getMetadata();
                size = Number(meta.size ?? 0);
            } catch {
                return refuse('unreadable', `${f.source.storagePath} was not found`);
            }
            counts.bytes += size;
            if (size > maxBytes) return refuse('too-large', `${f.source.storagePath} is ${(size / 1024 / 1024).toFixed(1)} MB; ${purposeId} takes at most ${limit.maxMb} MB`);
            if (counts.bytes > MAX_REQUEST_BYTES) return refuse('too-large', 'the files come to more than 20 MB together');
            [bytes] = await file.download();
        } else {
            counts.bytes += bytes.length;
            if (bytes.length > maxBytes) return refuse('too-large', `part ${f.index + 1} is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; ${purposeId} takes at most ${limit.maxMb} MB`);
            if (counts.bytes > MAX_REQUEST_BYTES) return refuse('too-large', 'the files come to more than 20 MB together');
        }
        const real = sniffType(bytes);
        const fits = kind === 'pdf' ? real === PDF_TYPE : real !== null && PICTURE_TYPES.includes(real);
        if (!fits) return refuse('unreadable', `part ${f.index + 1} is not a ${kind === 'pdf' ? 'PDF' : 'JPEG, PNG or WebP picture'}`);
        prepared.push({ index: f.index, part: { kind, mimeType: real!, bytes, name: f.source.name, storagePath: f.source.storagePath ?? null } });
    }
    prepared.sort((a, b) => a.index - b.index).forEach((p) => parts.push(p.part));
    return { ok: true, parts, ...counts };
}

function guessFromPath(path: string | undefined): string {
    const ext = path?.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'pdf') return PDF_TYPE;
    return '';
}
