/**
 * The admin strip on the pages the app draws itself (specs/visual-editing-spec.md,
 * VE-D12): the same bar as on published pages, drawn by the same script,
 * arc-site.js, so there is one bar with one look and one set of rules.
 *
 * `setArcEntry` calls this each time a page names what it is, or stops naming
 * it. For an editor (the flag `rememberEditorStrip` keeps) the first call loads
 * arc-site.js with data-parts="strip", which runs only the strip; later calls ask
 * it to follow the page. For anyone else nothing is loaded.
 */
import { EDITOR_STRIP_KEY } from './signed-in-hint';
import { arcSiteScriptElement, panelStrings } from './live-parts';

/** The script element the app adds for the strip, kept for the whole visit. */
export const STRIP_SCRIPT_ID = 'arc-editor-strip-script';

type ArcSiteWindow = Window & { arcSite?: { drawEditorStrip?: (strings?: Record<string, string>) => void } };

/**
 * The site's strings for the page's language, as UiStringsService last made them
 * the page's (VE3.11): the strip says its links in them, as on published pages.
 */
let stripStrings: Record<string, string> = {};

/** The page's language changed: the strip's words follow it. */
export function setEditorStripStrings(strings: Record<string, string>): void {
    stripStrings = panelStrings(strings);
    refreshEditorStrip();
}

function editorOnThisBrowser(): boolean {
    try {
        return localStorage.getItem(EDITOR_STRIP_KEY) === '1';
    } catch {
        return false;
    }
}

/** Draws, follows or takes away the strip for the page as it is now. */
export function refreshEditorStrip(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
    const win = doc?.defaultView as ArcSiteWindow | null | undefined;
    if (!doc || !win || !doc.body) return;
    const draw = win.arcSite?.drawEditorStrip;
    if (draw) {
        draw(stripStrings);
        return;
    }
    if (!editorOnThisBrowser() || doc.getElementById(STRIP_SCRIPT_ID)) return;
    const script = arcSiteScriptElement(doc, stripStrings);
    script.id = STRIP_SCRIPT_ID;
    script.setAttribute('data-parts', 'strip');
    doc.body.appendChild(script);
}
