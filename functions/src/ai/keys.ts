/**
 * The providers' keys (specs/ai-spec.md, AI-D8): `AiKeys/{connectionId}`, which no browser
 * can read or write, not even an admin's. Admins set, replace and remove a key in Settings,
 * AI through admin-only callables; the page sees only its preview on the connection.
 *
 * A key is stored with the address and the header it was set for (specs/ai-media-spec.md,
 * AM-D8). When the connection's address or header changes, the key is not sent until it is
 * set again, so changing either cannot carry a key to another server or another header. Keys are read when a call needs one and kept in memory for a minute, so
 * a new key works within a minute, with no deploy.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { connectionAuth, connectionBaseUrl, type AiConnection } from './settings.js';

export const AI_KEYS = 'AiKeys';
const CACHE_MS = 60_000;
export const MIN_KEY_LENGTH = 8;
export const MAX_KEY_LENGTH = 400;

const cache = new Map<string, { at: number; key: string | null; baseUrl: string; header: string; setAtIso: string }>();

/** What the admin page shows of a key: dots and its last 4 characters. */
export function keyPreview(key: string): string {
    return `••••${key.slice(-4)}`;
}

/** A key as typed: trimmed, one line, of a sensible length; null when it cannot be one. */
export function cleanKey(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const key = value.trim();
    if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH || /\s/.test(key)) return null;
    return key;
}

export type KeyRead = { ok: true; key: string } | { ok: false; detail: string };

/**
 * The key of a connection, when it was set for the address the connection has now. The copy
 * kept in memory is read again when Settings, AI says the key was set at another moment (a
 * new key, or none), so another instance never goes on sending an old key; `fresh` reads it
 * again whatever (the admin's Test).
 */
export async function readKey(connection: AiConnection, now = Date.now(), options: { fresh?: boolean } = {}): Promise<KeyRead> {
    let entry = cache.get(connection.id);
    const stale = !entry || options.fresh || now - entry.at >= CACHE_MS || entry.setAtIso !== (connection.keySetAt ?? '');
    if (stale) {
        const snap = await db.collection(AI_KEYS).doc(connection.id).get();
        const data = snap.exists ? snap.data() ?? {} : {};
        entry = {
            at: now,
            key: typeof data['key'] === 'string' ? data['key'] : null,
            baseUrl: typeof data['baseUrl'] === 'string' ? data['baseUrl'] : '',
            // Keys set before headers were stored went in Authorization.
            header: typeof data['header'] === 'string' && data['header'] ? data['header'] : 'authorization',
            setAtIso: typeof data['setAtIso'] === 'string' ? data['setAtIso'] : '',
        };
        cache.set(connection.id, entry);
    }
    entry = entry!;
    if (!entry.key) return { ok: false, detail: `connection ${connection.id} has no key: set one in Settings, AI` };
    if (entry.baseUrl !== connectionBaseUrl(connection)) {
        return { ok: false, detail: `the key of connection ${connection.id} was set for another address: set it again in Settings, AI` };
    }
    if (entry.header !== connectionAuth(connection).header) {
        return { ok: false, detail: `the key of connection ${connection.id} was set for another header: set it again in Settings, AI` };
    }
    return { ok: true, key: entry.key };
}

/** Store a key for a connection at its present address and header; `setAtIso` is the moment Settings, AI shows for it. */
export async function storeKey(connection: AiConnection, key: string, setBy: string, setAtIso: string): Promise<void> {
    await db.collection(AI_KEYS).doc(connection.id).set({ key, baseUrl: connectionBaseUrl(connection), header: connectionAuth(connection).header, setAt: Timestamp.now(), setAtIso, setBy });
    cache.delete(connection.id);
}

export async function deleteKey(connectionId: string): Promise<void> {
    await db.collection(AI_KEYS).doc(connectionId).delete();
    cache.delete(connectionId);
}

/** For tests. */
export function forgetKeys(): void {
    cache.clear();
}
