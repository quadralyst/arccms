import { Meta } from '@angular/platform-browser';
import { refreshEditorStrip } from './editor-strip';

/**
 * What a page is, for the admin strip on the site (specs/visual-editing-spec.md,
 * VE-D11): the value of `<meta name="arc-entry">`. Published pages carry it from
 * the publish pipeline (`arcEntry` in functions/src/shared/html-document.ts, the
 * same values, compared by arc-entry.spec.ts); a page the app draws, before its
 * file is on Hosting, carries it from here. It names no person and no draft state.
 */
export const arcEntry = {
    /** A content page: `{type}/{id}`; a published entry's id is its draft's. */
    content: (type: string, id: string): string => `${type}/${id}`,
    /** A type's list page: `{type}`. */
    list: (type: string): string => type,
    /** The home page, in every language. */
    home: (): string => 'home',
    /** A static page, served at `/p/{name}`: `p/{name}`. */
    staticPage: (name: string): string => `p/${name}`,
};

/**
 * Writes the page's arc-entry meta, or removes it (null) when the page is left or
 * is not one to name, and has the admin strip follow it (editor-strip.ts).
 * `editable` adds `data-arc-editable=""`, as publishing does for a static page
 * with marked areas (specs/visual-editing-spec.md, VE-D56).
 */
export function setArcEntry(meta: Meta, entry: string | null, editable = false): void {
    if (entry) {
        const tag = meta.updateTag(editable ? { name: 'arc-entry', content: entry, 'data-arc-editable': '' } : { name: 'arc-entry', content: entry });
        // The same tag carries on from the page before: it may have said so.
        if (!editable) tag?.removeAttribute('data-arc-editable');
    } else {
        meta.removeTag("name='arc-entry'");
    }
    refreshEditorStrip();
}
