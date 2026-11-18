/**
 * Remembers on this browser whether someone is signed in to the app, for the
 * published pages: arc-site.js (public/assets/js/arc-site.js) reads it to show
 * `data-arc-signed-in` elements ("Open the app") instead of
 * `data-arc-signed-out` ones ("Sign up"), and a page's own script may read it
 * too (docs/website/home-page.html). The key and its value are a stable,
 * documented contract: `arc:signed-in` is `'1'` while someone is signed in and
 * absent otherwise. A hint only, never a credential: it holds no identity and
 * grants nothing.
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

/** Whether this browser was signed in to the app when it last knew; false when storage is off. */
export function readSignedIn(): boolean {
    try {
        return localStorage.getItem(SIGNED_IN_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * The admin strip on published pages (specs/visual-editing-spec.md, VE-D12):
 * `arc_editor_strip` is `'1'` while someone the entry editor lets in is signed
 * in on this browser, and absent otherwise. arc-site.js reads it to draw links
 * to the edit screen. Like the signed-in hint it grants nothing: the edit
 * screen checks the person's role as every admin page does.
 */
export const EDITOR_STRIP_KEY = 'arc_editor_strip';

/** The roles the entry editor and the edit-on-page screen let in (app.routes.ts). */
export const ENTRY_EDITOR_ROLES: readonly string[] = ['admin'];

export function rememberEditorStrip(on: boolean): void {
    try {
        if (on) localStorage.setItem(EDITOR_STRIP_KEY, '1');
        else localStorage.removeItem(EDITOR_STRIP_KEY);
    } catch {
        // Storage off: no strip on the published pages.
    }
}
