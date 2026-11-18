/**
 * The admin strip on the pages the app draws (specs/visual-editing-spec.md, VE-D12):
 * loaded only for an editor, once, as arc-site.js running only the strip; then it
 * follows every page that names itself, and leaves on sign-out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Meta } from '@angular/platform-browser';
import { refreshEditorStrip, STRIP_SCRIPT_ID } from './editor-strip';
import { setArcEntry } from './arc-entry';
import { EDITOR_STRIP_KEY, rememberEditorStrip } from './signed-in-hint';

type ArcWindow = Window & { arcSite?: { drawEditorStrip?: () => void } };

describe('refreshEditorStrip', () => {
    const script = () => document.getElementById(STRIP_SCRIPT_ID) as HTMLScriptElement | null;

    beforeEach(() => {
        localStorage.removeItem(EDITOR_STRIP_KEY);
        delete (window as ArcWindow).arcSite;
    });

    afterEach(() => {
        script()?.remove();
        delete (window as ArcWindow).arcSite;
        localStorage.removeItem(EDITOR_STRIP_KEY);
    });

    it('loads nothing for a visitor', () => {
        refreshEditorStrip();
        expect(script()).toBeNull();
    });

    it('loads arc-site.js once for an editor, to run only the strip', () => {
        localStorage.setItem(EDITOR_STRIP_KEY, '1');
        refreshEditorStrip();
        refreshEditorStrip();
        expect(document.querySelectorAll(`#${STRIP_SCRIPT_ID}`)).toHaveLength(1);
        expect(script()!.getAttribute('src')).toMatch(/^\/assets\/js\/arc-site\.js/);
        expect(script()!.getAttribute('data-parts')).toBe('strip');
    });

    it('asks the strip already running to follow the page, for an editor or not', () => {
        const drawEditorStrip = vi.fn();
        (window as ArcWindow).arcSite = { drawEditorStrip };
        refreshEditorStrip();
        expect(drawEditorStrip).toHaveBeenCalledTimes(1);
        expect(script()).toBeNull();
    });

    it('is asked every time a page names what it is, or stops', () => {
        const drawEditorStrip = vi.fn();
        (window as ArcWindow).arcSite = { drawEditorStrip };
        const meta = new Meta(document);
        setArcEntry(meta, 'articles/doc1');
        expect(document.querySelector('meta[name="arc-entry"]')!.getAttribute('content')).toBe('articles/doc1');
        setArcEntry(meta, null);
        expect(document.querySelector('meta[name="arc-entry"]')).toBeNull();
        expect(drawEditorStrip).toHaveBeenCalledTimes(2);
    });

    it('follows signing out at once', () => {
        const drawEditorStrip = vi.fn();
        (window as ArcWindow).arcSite = { drawEditorStrip };
        rememberEditorStrip(false);
        expect(drawEditorStrip).toHaveBeenCalledTimes(1);
    });
});
