/**
 * Remembers on this browser whether someone is signed in to the app, for the
 * published pages: arc-site.js (public/assets/js/arc-site.js) reads it to show
 * `data-arc-signed-in` elements ("Open the app") instead of
 * `data-arc-signed-out` ones ("Sign up"). A hint only, never a credential: it
 * holds no identity and grants nothing.
 */
export const SIGNED_IN_KEY = 'arc:signed-in';

export function rememberSignedIn(signedIn: boolean): void {
    try {
        if (signedIn) localStorage.setItem(SIGNED_IN_KEY, '1');
        else localStorage.removeItem(SIGNED_IN_KEY);
    } catch {
        // Storage off: the published page shows its signed-out version.
    }
}
