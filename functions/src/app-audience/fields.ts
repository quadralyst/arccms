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
 * Field names whose values must never reach the admin UI, event data or an
 * email, even as examples. A host app's user documents can hold credentials (a
 * `password` field was found in the dev project's), and the Settings page shows
 * sampled values.
 *
 * A name is split into words (`stripeSecretKey` is stripe, secret, key;
 * `otp_code` is otp, code) and is sensitive when:
 * - its letters contain a word that is never harmless (`password`, `secret`,
 *   `token`, `credential`, `jwt`, ...), or
 * - one of its words is a short credential word (`otp`, `pin`, `pwd`, `hash`,
 *   `salt`, `cvv`, `ssn`, ...), or
 * - it pairs a qualifier with `key`, `code` or `id` (`apiKey`, `resetCode`,
 *   `sessionId`).
 * Whole words keep `shipping`, `zipCode` or `keyboard` visible.
 */
const SENSITIVE_LETTERS = [
    'password', 'passwd', 'passcode', 'passphrase', 'secret', 'token', 'credential', 'jwt',
    'apikey', 'privatekey', 'accesskey', 'secretkey', 'signingkey', 'encryptionkey', 'sessionid',
];
const SENSITIVE_WORDS = new Set(['pass', 'pwd', 'otp', 'totp', 'pin', 'hash', 'salt', 'cvv', 'cvc', 'ssn', 'iban', 'mfa', '2fa']);
const QUALIFIED = new Map<string, Set<string>>([
    ['key', new Set(['api', 'private', 'access', 'secret', 'signing', 'encryption', 'auth', 'license', 'recovery', 'session'])],
    ['code', new Set(['verification', 'verify', 'reset', 'auth', 'recovery', 'backup', 'access', 'security', 'login', 'confirmation', 'otp'])],
    ['id', new Set(['session'])],
    ['cookie', new Set(['session', 'auth'])],
]);

export const MASKED_VALUE = '(hidden)';

/** The words of one field name: camelCase, snake_case, kebab-case and ACRONYMS split. */
function nameWords(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((word) => word.toLowerCase());
}

/** Whether one field name (a single path segment) looks like a credential. */
export function isSensitiveName(name: string): boolean {
    const letters = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SENSITIVE_LETTERS.some((word) => letters.includes(word))) return true;
    const words = nameWords(name);
    if (words.some((word) => SENSITIVE_WORDS.has(word))) return true;
    return words.some((word, i) => i > 0 && (QUALIFIED.get(word)?.has(words[i - 1]) ?? false));
}

/**
 * Whether a field path looks like a credential. Any segment counts, so
 * everything under `credentials` or `auth.tokens` is hidden with it.
 */
export function isSensitiveField(path: string): boolean {
    return path.split('.').some(isSensitiveName);
}

/** A yes/no or empty value says nothing secret (`passwordless: true`), whatever its name. */
function cannotHoldSecret(value: unknown): boolean {
    return value === null || value === undefined || typeof value === 'boolean';
}

/**
 * A value with every credential-like key inside it hidden, at any depth and
 * inside lists. For showing a map or list that is not flattened further.
 */
export function redactValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactValue);
    if (!isPlainMap(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
        out[key] = isSensitiveName(key) && !cannotHoldSecret(inner) ? MASKED_VALUE : redactValue(inner);
    }
    return out;
}

/** The display value of a host value that may hold credentials inside it. */
export function safeDisplayValue(value: unknown): string {
    return displayValue(redactValue(value));
}

/**
 * A host value as text for comparing two versions of it: complete (never
 * shortened) and with map keys in a fixed order, so any real change shows.
 */
export function comparableValue(value: unknown): string {
    const normalize = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(normalize);
        if (isPlainMap(v)) {
            return Object.fromEntries(Object.keys(v).sort().map((key) => [key, normalize(v[key])]));
        }
        if (v !== null && typeof v === 'object') return displayValue(v);
        return v;
    };
    const normalized = normalize(value);
    return typeof normalized === 'string' ? normalized : JSON.stringify(normalized) ?? '';
}

/**
 * Every leaf field of a document as `path → display value`, maps followed three
 * levels deep. A credential-like path is hidden whole; a deeper map or a list is
 * shown with the credential-like keys inside it hidden.
 */
export function flattenFields(data: Record<string, unknown>, prefix = '', depth = 0, out: Record<string, string> = {}): Record<string, string> {
    for (const [key, value] of Object.entries(data)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (isSensitiveField(path) && !cannotHoldSecret(value)) out[path] = MASKED_VALUE;
        else if (isPlainMap(value) && depth < 2) flattenFields(value, path, depth + 1, out);
        else out[path] = safeDisplayValue(value);
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
    const text = (path?: string) => (path ? safeDisplayValue(valueAt(data, path)).trim() : '');
    return {
        docId,
        key: settings.key.source === 'field' ? text(settings.key.field) : docId,
        email: text(settings.emailField).toLowerCase(),
        phone: text(settings.phoneField),
        name: text(settings.nameField),
    };
}

/**
 * A resolved person as the browser may see it: a channel read from a
 * credential-like field is hidden, even when the admin picked it.
 */
export function maskResolvedAppUser(person: ResolvedAppUser, settings: AppAudienceSettings): ResolvedAppUser {
    const mask = (path: string | undefined, value: string) => (path && isSensitiveField(path) ? MASKED_VALUE : value);
    return {
        ...person,
        key: mask(settings.key.source === 'field' ? settings.key.field : undefined, person.key),
        email: mask(settings.emailField, person.email),
        phone: mask(settings.phoneField, person.phone),
        name: mask(settings.nameField, person.name),
    };
}
