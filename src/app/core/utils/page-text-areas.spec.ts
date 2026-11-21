/**
 * The areas a page's file marks, as the classic editor lists them
 * (page-text-areas.ts, specs/visual-editing-spec.md VE-D41, VE-D50).
 */
import { describe, it, expect } from 'vitest';
import { readPageFile, backgroundUrlOf, wordsKept } from './page-text-areas';
import { pageTextKind } from './page-text';

const FILE = `<!DOCTYPE html><html><head>
<title data-arc-t="home_title" data-arc-edit="title">Fresh bread</title>
<meta name="description" content="Baked  daily." data-arc-t-attr="content:home_description">
</head><body>
<arc-header></arc-header>
<section data-arc-label="Welcome">
  <h1 data-arc-edit="hero" data-arc-t="home_hero" data-arc-placeholder="A headline">Fresh   bread
     every morning</h1>
  <div data-arc-edit="intro" data-arc-edit-kind="rich" data-arc-label="Introduction"> Baked <b>early</b>. </div>
  <img data-arc-edit="photo" src="/site/bread.jpg" alt="A loaf" data-arc-t-attr="alt:photo_alt">
  <a data-arc-edit="cta" href="/p/menu">See the menu</a>
  <a data-arc-edit="insta" href="https://instagram.example"><svg></svg></a>
</section>
<section><h2>Kind words</h2>
  <arc-content-partials content-type="testimonials" count="3" section-title="Kind words" data-arc-edit="testimonials_title" data-arc-t-attr="section-title:kw"></arc-content-partials>
</section>
<div data-arc-edit="band" data-arc-edit-kind="background" style="color: red; background-image: url('/site/band.jpg')"></div>
<p data-arc-edit="hero">A second hero is ignored</p>
<script data-arc-edit="code">x()</script>
<p data-arc-edit="bad.key">No</p>
<arc-content-partials content-type="articles"></arc-content-partials>
<arc-footer><arc-content-partials content-type="news"></arc-content-partials></arc-footer>
</body></html>`;

describe('readPageFile', () => {
    const page = readPageFile(FILE);

    it('lists each marked area once, in page order, with what the file has in it', () => {
        expect(page.areas.map((a) => [a.key, a.kind])).toEqual([
            ['hero', 'text'], ['intro', 'rich'], ['photo', 'picture'], ['cta', 'link'], ['insta', 'link'],
            ['testimonials_title', 'section-title'], ['band', 'background'],
        ]);
        const [hero, intro, photo, cta, insta, title, band] = page.areas;
        expect(hero).toMatchObject({ fileText: 'Fresh bread every morning', stringKey: 'home_hero', placeholder: 'A headline' });
        expect(intro).toMatchObject({ fileText: 'Baked <b>early</b>.', label: 'Introduction' });
        expect(photo).toMatchObject({ fileText: 'A loaf', fileUrl: '/site/bread.jpg', stringKey: 'photo_alt' });
        expect(cta).toMatchObject({ fileText: 'See the menu', fileUrl: '/p/menu', addressOnly: false });
        expect(insta).toMatchObject({ fileText: '', fileUrl: 'https://instagram.example', addressOnly: true });
        expect(title).toMatchObject({ fileText: 'Kind words', stringKey: 'kw' });
        expect(band).toMatchObject({ fileUrl: '/site/band.jpg', section: { index: -1, label: '' } });
    });

    it('groups areas by their section, named by its label or first heading', () => {
        expect(page.areas[0].section).toEqual({ index: 0, label: 'Welcome' });
        expect(page.areas[5].section).toEqual({ index: 1, label: 'Kind words' });
    });

    it('lists the page\'s card blocks, not the header\'s or footer\'s', () => {
        expect(page.cardBlocks).toEqual([
            { type: 'testimonials', count: 3, fileTitle: 'Kind words', titleKey: 'testimonials_title', section: { index: 1, label: 'Kind words' } },
            { type: 'articles', count: 4, fileTitle: '', titleKey: '', section: { index: -1, label: '' } },
        ]);
    });

    it('reads the title and description, and their string keys', () => {
        expect(page).toMatchObject({ title: 'Fresh bread', description: 'Baked daily.', titleStringKey: 'home_title', descriptionStringKey: 'home_description' });
    });

    it('reads a page with nothing marked', () => {
        expect(readPageFile('<html><head></head><body><p>Hi</p></body></html>')).toMatchObject({ areas: [], cardBlocks: [], title: '' });
    });

    it('decides kinds as publishing does', () => {
        const doc = new DOMParser().parseFromString(FILE, 'text/html');
        for (const element of Array.from(doc.querySelectorAll('[data-arc-edit]'))) {
            const area = page.areas.find((a) => a.key === element.getAttribute('data-arc-edit'));
            const kind = pageTextKind(element.tagName, element.getAttribute('data-arc-edit-kind'), element.getAttribute('name'));
            if (area && element === doc.querySelector(`[data-arc-edit="${area.key}"]`)) expect(area.kind).toBe(kind);
            if (element.tagName === 'SCRIPT') expect(kind).toBe('none');
        }
    });

    it('reads a background address however it is quoted', () => {
        expect(backgroundUrlOf('background-image: url("/a.jpg")')).toBe('/a.jpg');
        expect(backgroundUrlOf('background-image:url(/b.jpg); color: red')).toBe('/b.jpg');
        expect(backgroundUrlOf('color: red')).toBe('');
    });
});

describe('areas whose words are kept as the file has them (review M2, M3)', () => {
    it('are not offered to editors: plain text holding elements, an area holding another', () => {
        const file = readPageFile('<body><h1 data-arc-edit="styled">Hi <em>you</em></h1>'
            + '<div data-arc-edit="outer" data-arc-edit-kind="rich">A <span data-arc-edit="inner">B</span></div>'
            + '<a data-arc-edit="cta" href="/x"><i></i></a><p data-arc-edit="plain">P</p></body>');
        expect(file.areas.map((a) => a.key)).toEqual(['inner', 'cta', 'plain']);
    });

    it('only for words: a link or a picture is never kept back', () => {
        const box = new DOMParser().parseFromString('<a data-arc-edit="a"><b data-arc-edit="b">x</b></a>', 'text/html').body.firstElementChild!;
        expect(wordsKept(box, 'link')).toBe(false);
        expect(wordsKept(box, 'rich')).toBe(true);
    });
});
