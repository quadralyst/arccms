import { CUSTOM_HOME } from '../../../custom/home';

/**
 * Where each role lands after signing in, when no page asked for them
 * (docs/custom-code.md). Keys are roles (`admin`, `user`, or an install's own
 * role); `*` is everyone else.
 */
export type HomePages = Partial<Record<string, string>>;

export const DEFAULT_HOME: HomePages = {
    admin: '/admin/dashboard',
    '*': '/user/dashboard',
};

/** Arc CMS's account overview, where signed-in people land unless the app says otherwise. */
export const USER_DASHBOARD = '/user/dashboard';

/** The home page for a role: the app's choice (src/custom/home.ts), else Arc CMS's. */
export function homeFor(role: string | null | undefined, custom: HomePages = CUSTOM_HOME): string {
    const key = role || 'user';
    return custom[key] ?? DEFAULT_HOME[key] ?? custom['*'] ?? DEFAULT_HOME['*']!;
}

/** Pages that must never be the place someone returns to after signing in. */
const NOT_A_DESTINATION = /^\/(signup|login|auth-checker|onboarding)(\/|\?|#|$)/;

/**
 * The `redirect` a sign-in link carries (`/signup?redirect=/learn`), if it is a
 * page on this site. Anything else is ignored, so a crafted link cannot send
 * people to another site after they sign in: full addresses, `//host`, `/\host`,
 * and the sign-in pages themselves.
 */
export function safeRedirect(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 2000) return null;
    if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
    if (/[\u0000-\u001f]/.test(value)) return null;
    if (NOT_A_DESTINATION.test(value)) return null;
    return value;
}
