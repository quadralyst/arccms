/** The pages the page editors open, and where their screens are (page-ref.ts, specs/visual-editing-spec.md VE-D49, VE-D58, VE-D65). */
import { describe, it, expect } from 'vitest';
import { classicEditorLink, pageIdOf, pagePreviewPath, pageRefFrom, visualEditorLink, type PageRef } from './page-ref';

const HOME: PageRef = { kind: 'home', name: '' };
const ABOUT: PageRef = { kind: 'static', name: 'about us' };
const LIST: PageRef = { kind: 'list', name: 'articles' };
const params = (values: Record<string, string>) => ({ get: (key: string) => values[key] ?? null });

describe('a page of the page editors', () => {
    it('is named by its route', () => {
        expect(pageRefFrom(params({}))).toEqual(HOME);
        expect(pageRefFrom(params({ name: 'about us' }))).toEqual(ABOUT);
        expect(pageRefFrom(params({ type: 'articles' }))).toEqual(LIST);
    });

    it('keeps its words under its own id, so a type and a static page of one name never share them', () => {
        expect([HOME, ABOUT, LIST, { kind: 'static', name: 'articles' } as PageRef].map(pageIdOf)).toEqual(['home', 'p-about us', 'list-articles', 'p-articles']);
    });

    it('has its classic editor, Visual Editor and Live Preview', () => {
        expect([HOME, ABOUT, LIST].map(classicEditorLink)).toEqual([['/admin/more-pages/home'], ['/admin/more-pages/p', 'about us'], ['/admin/more-pages/list', 'articles']]);
        expect([HOME, ABOUT, LIST].map(visualEditorLink)).toEqual([['/admin/edit-page/home'], ['/admin/edit-page/p', 'about us'], ['/admin/edit-page/list', 'articles']]);
        expect(pagePreviewPath(LIST, 'en', 'en')).toBe('/admin/preview-page/list/articles');
        expect(pagePreviewPath(LIST, 'hi', 'en')).toBe('/admin/preview-page/list/articles/hi');
        expect(pagePreviewPath(HOME, 'hi', 'en')).toBe('/admin/preview-page/home/hi');
        // A static page has the default language only.
        expect(pagePreviewPath(ABOUT, 'hi', 'en')).toBe('/admin/preview-page/p/about%20us');
    });
});
