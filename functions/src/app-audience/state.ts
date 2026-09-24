/**
 * ArcCMS's own records about app users (docs/coexistence-spec.md 5b): consent,
 * drip progress, watched-field values. `AppAudience/{stateId}`, where the id is a
 * hash of the person's unique key, so no identifier from the host app is stored
 * in the clear. A person with no record has the defaults: subscribed, no drips.
 */
import { createHash } from 'node:crypto';

export const APP_AUDIENCE_STATE = 'AppAudience';

/** Every app user is subscribed unless they unsubscribed (decided 2026-09-24). */
export const DEFAULT_APP_USER_CONSENT = 'subscribed';

export type AppUserConsent = 'subscribed' | 'unsubscribed';

/** The state document id for a unique key. */
export function appUserStateId(key: string): string {
    return createHash('sha256').update(key.trim()).digest('hex');
}

export interface AppUserState {
    consent: AppUserConsent;
}

export function stateFrom(data: Record<string, unknown> | undefined): AppUserState {
    return { consent: data?.['consent'] === 'unsubscribed' ? 'unsubscribed' : DEFAULT_APP_USER_CONSENT };
}
