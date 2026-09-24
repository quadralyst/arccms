/**
 * Reading host documents as ArcCMS sees them (App audience, CO6.2): a value at a
 * dot path, a document flattened into field paths for the admin's picker, and
 * one document resolved into key, email, phone and name.
 */
import type { AppAudienceSettings } from './config.js';

/** The value at a dot path such as `subscription.tier`, or undefined. */
export function valueAt(data: unknown, path: string): unknown {
    let current: unknown = data;
    for (const part of path.split('.')) {
        if (current === null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

/** Firestore values made readable: timestamps as ISO strings, references as paths. */
export function displayValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    const v = value as { toDate?: () => Date; path?: string; latitude?: number; longitude?: number };
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (typeof v.path === 'string') return v.path;
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number') return `${v.latitude},${v.longitude}`;
    try {
        const json = JSON.stringify(value);
        return json.length > 120 ? `${json.slice(0, 117)}...` : json;
    } catch {
        return String(value);
    }
}

function isPlainMap(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const v = value as { toDate?: unknown; path?: unknown; latitude?: unknown };
    return typeof v.toDate !== 'function' && typeof v.path !== 'string' && typeof v.latitude !== 'number';
}

/**
 * Field names whose values must never reach the admin UI, even as examples.
 * A host app's user documents can hold credentials (a `password` field was
 * found in the dev project's), and the Settings page shows sampled values.
 */
const SENSITIVE_FIELD = /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|otp|pin|hash|salt|credential)s?$/i;

export const MASKED_VALUE = '(hidden)';

/** Whether a field path's last segment looks like a credential. */
export function isSensitiveField(path: string): boolean {
    const last = path.split('.').pop() ?? path;
    return SENSITIVE_FIELD.test(last);
}

/** Every leaf field of a document as `path → display value`, maps followed three levels deep. */
export function flattenFields(data: Record<string, unknown>, prefix = '', depth = 0, out: Record<string, string> = {}): Record<string, string> {
    for (const [key, value] of Object.entries(data)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (isPlainMap(value) && depth < 2) flattenFields(value, path, depth + 1, out);
        else out[path] = isSensitiveField(path) ? MASKED_VALUE : displayValue(value);
    }
    return out;
}

export interface ResolvedAppUser {
    docId: string;
    key: string;
    email: string;
    phone: string;
    name: string;
}

/** One host document read through the admin's settings. */
export function resolveAppUser(docId: string, data: Record<string, unknown>, settings: AppAudienceSettings): ResolvedAppUser {
    const text = (path?: string) => (path ? displayValue(valueAt(data, path)).trim() : '');
    return {
        docId,
        key: settings.key.source === 'field' ? text(settings.key.field) : docId,
        email: text(settings.emailField).toLowerCase(),
        phone: text(settings.phoneField),
        name: text(settings.nameField),
    };
}
