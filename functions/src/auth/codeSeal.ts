/**
 * One code at a time (specs/sign-in-codes-spec.md, SC4): asking again while a
 * code still works sends the same code, so two messages never carry different
 * codes and the person never has to guess which one works.
 *
 * To send it again the server keeps the code, sealed (AES-256-GCM) with a key
 * derived from the PIN pepper in `_system`, which no client can read, and bound
 * to its document, so a sealed code cannot be moved to another number or
 * address. A guess is still checked against the hash beside it. The hash alone
 * protected little: a 6-digit code has only a million values.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { pinPepper } from './accounts.js';

/** How long one code can be sent again from when it was made; then a new one. */
export const CODE_REUSE_MS = 30 * 60 * 1000;

const VERSION = 'v1';

/** The sealing key: the PIN pepper, keyed for this one use. */
export async function codeSealKey(): Promise<Buffer> {
    return createHmac('sha256', await pinPepper()).update('arc-sign-in-code-seal').digest();
}

/** The code sealed for the document `docId`: `v1.iv.tag.text`, base64url. */
export function sealCode(code: string, docId: string, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(docId));
    const text = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), text].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

/** The code, or null when `sealed` is missing, damaged, or for another document. */
export function openCode(sealed: unknown, docId: string, key: Buffer): string | null {
    if (typeof sealed !== 'string') return null;
    const [version, iv, tag, text] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || !text) return null;
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        decipher.setAAD(Buffer.from(docId));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        const code = Buffer.concat([decipher.update(Buffer.from(text, 'base64url')), decipher.final()]).toString('utf8');
        return /^\d{6}$/.test(code) ? code : null;
    } catch {
        return null;
    }
}

function millis(value: unknown): number {
    return (value as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
}

/**
 * The code stored in `data` when it may be sent again: for the same request
 * (`samePurpose`), not verified, not expired, under `maxAttempts` wrong tries,
 * made under 30 minutes ago, and opening to a code that matches its hash.
 * Null means a new code.
 */
export function reusableCode(
    data: Record<string, unknown> | undefined,
    check: { samePurpose: boolean; docId: string; key: Buffer; now: number; maxAttempts: number; hash: (code: string) => string },
): string | null {
    if (!data || !check.samePurpose || data['verified'] === true) return null;
    if (millis(data['expiresAt']) <= check.now) return null;
    if (Number(data['attempts'] ?? 0) >= check.maxAttempts) return null;
    if (check.now - millis(data['issuedAt']) >= CODE_REUSE_MS) return null;
    const code = openCode(data['codeSealed'], check.docId, check.key);
    return code && check.hash(code) === data['codeHash'] ? code : null;
}

/** Seconds left before another code may be sent, or 0. */
export function resendWait(data: Record<string, unknown> | undefined, now: number, gapMs: number): number {
    const lastSent = millis(data?.['lastSentAt']);
    return now - lastSent < gapMs ? Math.ceil((gapMs - (now - lastSent)) / 1000) : 0;
}
