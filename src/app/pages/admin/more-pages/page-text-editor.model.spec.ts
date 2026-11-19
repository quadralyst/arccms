/**
 * What the classic editor shows per area and language (page-text-editor.model.ts,
 * specs/visual-editing-spec.md VE-D43 to VE-D47, VE-D50, VE-D51).
 */
import { describe, it, expect } from 'vitest';
import { readPageFile } from '../../../core/utils/page-text-areas';
import { areaView, goneKeys, sectionViews, seoView, type EditorContext } from './page-text-editor.model';
import type { PageTextDraft } from '../../../core/site/page-text.service';

const HOME = readPageFile(`<html><head><title data-arc-t="t">Bakery</title><meta name="description" content="Bread."></head><body>
<section data-arc-label="Welcome"><h1 data-arc-edit="hero" data-arc-t="hero_t">Hello</h1>
<img data-arc-edit="photo" src="/a.jpg" alt="A loaf"></section>
<section><h2>Words</h2><arc-content-partials content-type="testimonials" count="3" data-arc-edit="kw" section-title="Kind words"></arc-content-partials></section>
<a data-arc-edit="cta" href="/menu">Menu</a></body></html>`);
const HOME_HI = readPageFile(`<html><head><title>बेकरी</title></head><body><h1 data-arc-edit="hero">नमस्ते</h1></body></html>`);

const ctx = (over: Partial<EditorContext> = {}): EditorContext => ({
    lang: 'en', defaultLang: 'en', ownFile: true, file: HOME, defaultFile: HOME, strings: {}, draft: null, ...over,
});
const view = (key: string, c: EditorContext) => areaView(c.file.areas.find((a) => a.key === key)!, c);

describe('the classic editor\'s view of a page', () => {
    it('shows the file\'s words as the placeholder of an area nobody changed', () => {
        expect(view('hero', ctx())).toMatchObject({ words: '', wordsFallback: 'Hello', hasWords: true, hasUrl: false, wordsFileChanged: false });
        expect(view('photo', ctx())).toMatchObject({ hasWords: true, hasUrl: true, fileUrl: '/a.jpg', url: '' });
        expect(view('cta', ctx())).toMatchObject({ hasWords: true, hasUrl: true, fileUrl: '/menu' });
    });

    it('shows what was saved, and that the file changed since (VE-D45)', () => {
        const draft: PageTextDraft = { text: { en: { hero: { value: 'Hi all', fileText: 'Hello' } } }, urls: { photo: { value: '/b.jpg', fileText: '/old.jpg' } } };
        expect(view('hero', ctx({ draft }))).toMatchObject({ words: 'Hi all', wordsFileChanged: false });
        expect(view('photo', ctx({ draft }))).toMatchObject({ url: '/b.jpg', urlFileChanged: true });
        const changed: PageTextDraft = { text: { en: { hero: { value: 'Hi all', fileText: 'Hi there' } } } };
        expect(view('hero', ctx({ draft: changed })).wordsFileChanged).toBe(true);
    });

    it('in another language: its words, else the translation, else the default language\'s (VE-D43)', () => {
        const draft: PageTextDraft = { text: { en: { hero: { value: 'Hi all' } } } };
        const hi = ctx({ lang: 'hi', ownFile: false, draft });
        expect(view('hero', hi)).toMatchObject({ words: '', wordsFallback: 'Hi all', defaultWords: 'Hi all' });
        expect(view('hero', { ...hi, strings: { hero_t: 'स्वागत' } }).wordsFallback).toBe('स्वागत');
        expect(view('photo', hi)).toMatchObject({ wordsFallback: 'A loaf', defaultWords: 'A loaf' });
    });

    it('a language with its own file falls back to its own file\'s words', () => {
        const hi = ctx({ lang: 'hi', ownFile: true, file: HOME_HI, draft: { text: { en: { hero: { value: 'Hi all' } } } } });
        expect(view('hero', hi)).toMatchObject({ wordsFallback: 'नमस्ते', defaultWords: 'Hi all' });
    });

    it('says Check translation when the default language\'s words changed since (VE-D44)', () => {
        const draft: PageTextDraft = { text: { en: { hero: { value: 'Hi everyone' } }, hi: { hero: { value: 'नमस्ते सब', sourceText: 'Hi all' } } } };
        expect(view('hero', ctx({ lang: 'hi', ownFile: false, draft })).checkTranslation).toBe(true);
        const same: PageTextDraft = { text: { en: { hero: { value: 'Hi all' } }, hi: { hero: { value: 'नमस्ते सब', sourceText: 'Hi all' } } } };
        expect(view('hero', ctx({ lang: 'hi', ownFile: false, draft: same })).checkTranslation).toBe(false);
        expect(view('hero', ctx({ draft })).checkTranslation).toBe(false);
    });

    it('groups areas and card blocks by section, the rest last (VE-D50)', () => {
        const sections = sectionViews(ctx());
        expect(sections.map((s) => [s.index, s.label, s.areas.map((a) => a.area.key), s.blocks.map((b) => b.type)])).toEqual([
            [0, 'Welcome', ['hero', 'photo'], []],
            [1, 'Words', ['kw'], ['testimonials']],
            [-1, '', ['cta'], []],
        ]);
    });

    it('lists saved keys the files no longer mark (VE-D47)', () => {
        const draft: PageTextDraft = { text: { en: { hero: { value: 'a' }, old: { value: 'Old words' } }, hi: { gone_hi: { value: 'x' } } }, urls: { banner: { value: '/b.jpg' } } };
        expect(goneKeys(draft, [HOME, HOME_HI], 'en')).toEqual([
            { key: 'banner', text: '', url: '/b.jpg' }, { key: 'gone_hi', text: 'x', url: '' }, { key: 'old', text: 'Old words', url: '' },
        ]);
        expect(goneKeys(null, [HOME], 'en')).toEqual([]);
    });

    it('shows the SEO words with the file\'s, a translation\'s or the default language\'s as placeholders (VE-D51)', () => {
        expect(seoView(ctx())).toMatchObject({ title: '', titleFallback: 'Bakery', descriptionFallback: 'Bread.' });
        const draft: PageTextDraft = { seo: { en: { title: { value: 'Fresh bread' } } }, shareImage: { value: '/s.jpg' } };
        expect(seoView(ctx({ draft }))).toMatchObject({ title: 'Fresh bread', shareImage: '/s.jpg' });
        expect(seoView(ctx({ lang: 'hi', ownFile: false, draft })).titleFallback).toBe('Fresh bread');
        expect(seoView(ctx({ lang: 'hi', ownFile: false, draft, strings: { t: 'बेकरी' } })).titleFallback).toBe('बेकरी');
        expect(seoView(ctx({ lang: 'hi', ownFile: true, file: HOME_HI, draft })).titleFallback).toBe('बेकरी');
    });
});
