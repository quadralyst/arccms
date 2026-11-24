/** A list page's file as its editors read it (list-page-file.ts, specs/visual-editing-spec.md VE-D60, VE-D61). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ContentType } from '../../pages/admin/contents/content-types/content-types.model';
import { listLimit, listPageData, listPageFile, listPageNamed, showEveryArea, withoutListLimit } from './list-page-file';

const TYPE = {
    id: 't1', slug: 'articles', name: 'Articles', description: 'All our news',
    nameTranslations: { hi: { name: 'लेख', description: '' } },
} as unknown as ContentType;
const TEMPLATE = `<section class="hero">
<h1 data-arc-edit="title">{{ contentType }}</h1>
<p data-arc-edit="intro" data-arc-if="contentTypeDescription">{{ contentTypeDescription }}</p>
<p data-arc-edit="more" data-arc-t="more_of">More {{ contentType }}</p>
<a data-arc-edit="cta" href="/contact">Write to us</a></section>
<div data-arc-loop="items" data-limit="12"><article><h2 data-arc-edit="title">{{ title }}</h2></article></div>`;

const read = (lang: string, over: Partial<Parameters<typeof listPageFile>[0]> = {}) =>
    listPageFile({ template: TEMPLATE, type: TYPE, lang, defaultLang: 'en', strings: {}, siteInfo: {}, ...over });
const words = (file: ReturnType<typeof listPageFile>) => Object.fromEntries(file.areas.map((area) => [area.key, area.fileText]));

describe('a list page\'s file', () => {
    it('reads each area\'s words from the bound page, never the bindings', () => {
        const file = read('en');
        expect(words(file)).toEqual({ title: 'Articles', intro: 'All our news', more: 'More Articles', cta: 'Write to us' });
        expect(file.areas.find((area) => area.key === 'cta')).toMatchObject({ kind: 'link', fileUrl: '/contact' });
        expect(file.title).toBe('Articles');
        expect(file.description).toBe('All our news');
    });

    it('in another language: its strings and its own name of the type, and the strings\' keys kept', () => {
        const file = read('hi', { strings: { more_of: 'और {{ contentType }}' } });
        // Not described in Hindi: the default language's description.
        expect(words(file)).toEqual({ title: 'लेख', intro: 'All our news', more: 'और लेख', cta: 'Write to us' });
        expect(file.areas.find((area) => area.key === 'more')!.stringKey).toBe('more_of');
        expect(listPageNamed(TYPE, 'hi')).toEqual({ title: true, intro: false });
        expect(listPageNamed(TYPE, 'ta')).toEqual({ title: false, intro: false });
    });

    it.each(['articles', 'default', 'info', 'manuals'])('reads the shipped %s template: the type\'s name is its heading', (folder) => {
        const file = read('en', { template: readFileSync(resolve(process.cwd(), `public/_site/templates/${folder}/list.html`), 'utf8') });
        expect(words(file)['title']).toBe('Articles');
        // The info pages' list shows no description.
        expect(words(file)['intro']).toBe(folder === 'info' ? undefined : 'All our news');
        expect(file.cardBlocks).toHaveLength(1);
    });

    it('in the default language too, a name the type has there is the one published', () => {
        const type = { ...TYPE, nameTranslations: { en: { name: 'Stories', description: 'Told here' }, hi: { name: 'लेख' } } } as unknown as ContentType;
        expect(words(read('en', { type }))).toMatchObject({ title: 'Stories', intro: 'Told here', more: 'More Stories' });
        expect(listPageData(type, '', 'en')).toMatchObject({ contentType: 'Stories', lang: 'en', langPrefix: '' });
        expect(listPageData(type, 'hi', 'en')).toMatchObject({ contentType: 'लेख', lang: 'hi', langPrefix: '/hi' });
    });

    it('never offers a mark inside the loop: cards are their entries\'', () => {
        const file = read('en', { template: '<h1>{{ contentType }}</h1><div data-arc-loop="items"><h2 data-arc-edit="title">{{ title }}</h2></div>' });
        expect(file.areas).toEqual([]);
        // The type's name is still what Basic shows (VE-D60).
        expect(file.title).toBe('Articles');
    });

    it('offers an intro the template hides while the type has no description', () => {
        const file = read('en', { type: { ...TYPE, description: '' } });
        expect(words(file)['intro']).toBe('');
        expect(showEveryArea('<p data-arc-if="x">Kept</p>')).toBe('<p data-arc-if="x">Kept</p>');
        expect(showEveryArea('<div data-arc-loop="items"><p data-arc-edit="a" data-arc-if="x">1</p></div>')).toContain('data-arc-if="x"');
    });

    it('shows a type\'s name as words, never as HTML', () => {
        const file = read('en', { type: { ...TYPE, name: 'News <img src=x onerror=alert(1)>' } });
        expect(words(file)['title']).toBe('News <img src=x onerror=alert(1)>');
        expect(file.areas.find((area) => area.key === 'title')!.kind).toBe('text');
    });

    it('names the list\'s own cards for the classic editor, as many as the template shows', () => {
        expect(read('en').cardBlocks).toEqual([{ type: 'articles', count: 12, fileTitle: '', titleKey: '', section: { index: -1, label: '' } }]);
        expect(read('en', { template: '<h1 data-arc-edit="title">{{ contentType }}</h1>' }).cardBlocks).toEqual([]);
    });

    it('cuts at the template\'s own limit, at most 100', () => {
        expect(listLimit(TEMPLATE)).toBe(12);
        expect(listLimit('<ul data-arc-loop="items"></ul>')).toBe(100);
        expect(listLimit('<ul data-limit="500" data-arc-loop="items"></ul>')).toBe(100);
        // Another loop's limit is not the list's.
        expect(listLimit('<ul data-arc-site-loop="social" data-limit="3"></ul><ul data-arc-loop="items"></ul>')).toBe(100);
        expect(withoutListLimit('<ul data-arc-loop="items" data-limit="12" class="a">')).toBe('<ul data-arc-loop="items" class="a">');
        expect(withoutListLimit('<ul data-arc-loop="other" data-limit="12">')).toBe('<ul data-arc-loop="other" data-limit="12">');
    });
});
