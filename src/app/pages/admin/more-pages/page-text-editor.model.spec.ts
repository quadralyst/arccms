/**
 * What the classic editor shows per area and language (page-text-editor.model.ts,
 * specs/visual-editing-spec.md VE-D43 to VE-D47, VE-D50, VE-D51).
 */
import { describe, it, expect } from 'vitest';
import { readPageFile } from '../../../core/utils/page-text-areas';
import { LIST_PAGE_KEYS, areaView, goneKeys, hasFormatting, listBasics, listSeoView, plainAreaWords, sectionViews, seoView, type EditorContext } from './page-text-editor.model';
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

describe('a list page (VE-D60, VE-D69)', () => {
    const FILE = readPageFile('<h1 data-arc-edit="title">Articles</h1><p data-arc-edit="note">Read on</p>');
    const FILE_HI = readPageFile('<h1 data-arc-edit="title">लेख</h1><p data-arc-edit="note">Read on</p>');
    const list = (over: Partial<EditorContext> = {}): EditorContext => ({
        lang: 'en', defaultLang: 'en', ownFile: true, file: FILE, defaultFile: FILE, strings: {}, draft: null,
        list: { named: { title: false, intro: false }, words: { title: 'Articles', intro: 'News' }, defaultWords: { title: 'Articles', intro: 'News' } }, ...over,
    });
    const hindi = (named: { title: boolean; intro: boolean }, draft: PageTextDraft) => list({
        lang: 'hi', ownFile: false, file: FILE_HI, draft,
        list: { named, words: { title: 'लेख', intro: 'News' }, defaultWords: { title: 'Articles', intro: 'News' } },
    });

    it('has the heading and intro as its Title and Summary, marked on the page or not', () => {
        const basics = listBasics(list())!;
        expect(basics).toMatchObject({ titleMarked: true, introMarked: false });
        expect(basics.title).toMatchObject({ words: '', wordsFallback: 'Articles', fileWords: 'Articles' });
        // Not marked: the type's description, to be saved under the same key.
        expect(basics.intro).toMatchObject({ words: '', wordsFallback: 'News' });
        expect(basics.intro.area).toMatchObject({ key: 'intro', kind: 'text' });
        expect(listBasics(ctx())).toBeNull();
    });

    it('shows in Basic the value of its area, one value', () => {
        const context = list({ draft: { text: { en: { title: { value: 'Our stories' } } } } });
        expect(listBasics(context)!.title.words).toBe('Our stories');
        expect(sectionViews(context).flatMap((s) => s.areas).find((a) => a.area.key === 'title')!.words).toBe('Our stories');
    });

    it('a type named in a language keeps that name there over words edited in the default one only', () => {
        const draft: PageTextDraft = { text: { en: { title: { value: 'Our stories' }, note: { value: 'Go on' } } } };
        expect(listBasics(hindi({ title: true, intro: false }, draft))!.title).toMatchObject({ wordsFallback: 'लेख', defaultWords: 'Our stories' });
        expect(listBasics(hindi({ title: false, intro: false }, draft))!.title.wordsFallback).toBe('Our stories');
        // Any other area falls back as on every page.
        expect(view('note', hindi({ title: true, intro: true }, draft)).wordsFallback).toBe('Go on');
        expect(listBasics(hindi({ title: false, intro: false }, draft))!.intro.defaultWords).toBe('News');
    });

    it('an area with a translation shows the page\'s own words, its bindings filled in', () => {
        const file = { ...FILE_HI, areas: FILE_HI.areas.map((area) => (area.key === 'note' ? { ...area, stringKey: 'more_of', fileText: 'और लेख' } : area)) };
        const context = { ...hindi({ title: false, intro: false }, { text: { en: { note: { value: 'Go on' } } } }), file, strings: { more_of: 'और {{ contentType }}' } };
        expect(view('note', context).wordsFallback).toBe('और लेख');
    });

    it('its SEO words start empty and say what goes out without them, as published', () => {
        expect(listSeoView(list())).toEqual({ title: '', titleFallback: 'Articles', description: '', descriptionFallback: 'News', shareImage: '' });
        const draft: PageTextDraft = { text: { en: { title: { value: 'Our stories' } } }, seo: { en: { description: { value: 'All of them' } } }, shareImage: { value: '/s.jpg' } };
        expect(listSeoView(list({ draft }))).toEqual({ title: '', titleFallback: 'Our stories', description: 'All of them', descriptionFallback: 'News', shareImage: '/s.jpg' });
        expect(listSeoView(list({ list: { named: { title: false, intro: false }, words: { title: 'Articles', intro: '' }, defaultWords: { title: 'Articles', intro: '' } } }))!.descriptionFallback).toBe('Browse all articles');
    });

    it('never lists its Title and Summary as gone from the page', () => {
        const draft: PageTextDraft = { text: { en: { title: { value: 'a' }, intro: { value: 'b' }, old: { value: 'c' } } } };
        const bare = readPageFile('<h1>Articles</h1>');
        expect(goneKeys(draft, [bare], 'en', LIST_PAGE_KEYS).map((gone) => gone.key)).toEqual(['old']);
        expect(goneKeys(draft, [bare], 'en').map((gone) => gone.key)).toEqual(['intro', 'old', 'title']);
    });
});

describe('a list page with a rich intro (VE-D60)', () => {
    const FILE = readPageFile('<h1 data-arc-edit="title">Articles</h1><p data-arc-edit="intro" data-arc-edit-kind="rich">News</p>');
    const at = (intro: string): EditorContext => ({
        lang: 'en', defaultLang: 'en', ownFile: true, file: FILE, defaultFile: FILE, strings: {},
        draft: { text: { en: { intro: { value: intro } } } },
        list: { named: { title: false, intro: false }, words: { title: 'Articles', intro: 'News' }, defaultWords: { title: 'Articles', intro: 'News' } },
    });

    it('reads as words in Basic and in the preview, and only tags are formatting', () => {
        const plain = at('Tom &amp; Jerry\'s &lt;3');
        expect(plainAreaWords(listBasics(plain)!.intro, listBasics(plain)!.intro.words)).toBe('Tom & Jerry\'s <3');
        expect(listSeoView(plain)!.descriptionFallback).toBe('Tom & Jerry\'s <3');
        expect(hasFormatting(listBasics(plain)!.intro)).toBe(false);
        expect(hasFormatting(listBasics(at('All <b>news</b>'))!.intro)).toBe(true);
        expect(hasFormatting(listBasics(at('All<br>news'))!.intro)).toBe(true);
        // A plain area's value is words, however they look.
        expect(hasFormatting(listBasics({ ...at(''), draft: { text: { en: { title: { value: '<b>x</b>' } } } } })!.title)).toBe(false);
    });
});
