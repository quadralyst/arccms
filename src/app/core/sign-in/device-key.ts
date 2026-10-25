/**
 * This browser's device key (specs/sign-in-pin-spec.md, "Ask for a code on a new
 * device"): a random value made once and kept, which the sign-in calls send so the
 * server can tell a device it has seen (functions/src/auth/devices.ts keeps only its
 * hash). Where the browser keeps nothing (a private window, storage turned off) a key
 * lasts for this page only, and each sign-in there asks for a code.
 */
const STORAGE_KEY = 'arc-device-key';
let pageKey = '';

function newKey(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    // base64url, which the server accepts (32 to 128 of A-Z a-z 0-9 - _)
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deviceKey(): string {
    try {
        const kept = localStorage.getItem(STORAGE_KEY);
        if (kept && /^[A-Za-z0-9_-]{32,128}$/.test(kept)) return kept;
        const made = newKey();
        localStorage.setItem(STORAGE_KEY, made);
        return made;
    } catch {
        pageKey ||= newKey();
        return pageKey;
    }
}

const REMEMBERED = 'arc-device-remembered:';

/**
 * Whether this device was already reported for this person (rememberThisDevice), so a
 * signed-in session asks the server only once per device and account. False where the
 * browser keeps nothing: asking again there does no harm.
 */
export function deviceRemembered(uid: string): boolean {
    try {
        return localStorage.getItem(REMEMBERED + uid) === '1';
    } catch {
        return false;
    }
}

export function markDeviceRemembered(uid: string): void {
    try {
        localStorage.setItem(REMEMBERED + uid, '1');
    } catch { /* nothing kept: asked again next time */ }
}
