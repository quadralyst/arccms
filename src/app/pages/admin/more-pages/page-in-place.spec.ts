/**
 * Editing a page's areas where they are (page-in-place.ts,
 * specs/visual-editing-spec.md VE-D37, VE-D50, VE-D52, VE-D55).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readPageFile } from '../../../core/utils/page-text-areas';
import { areaView, type AreaView, type EditorContext } from './page-text-editor.model';
import { IN_PLACE_CSS, PageInPlace, cardOf, typedValue, type PageInPlaceHost } from './page-in-place';
import { pageEditFrameUrl } from './page-edit.page';
import type { PageTextDraft } from '../../../core/site/page-text.service';

const HTML = `<html><head></head><body>
<h1 data-arc-edit="hero">Hello</h1>
<div data-arc-edit="intro" data-arc-edit-kind="rich">Baked <b>early</b>.</div>
<img data-arc-edit="photo" src="/a.jpg" srcset="/a2.jpg 2x" data-src="/a.jpg" data-srcset="/a2.jpg 2x" alt="A loaf">
<a data-arc-edit="cta" href="/menu">Menu</a>
<section data-arc-edit="band" data-arc-edit-kind="background" style="color: red"></section>
<a href="/elsewhere" id="plain">Elsewhere</a>
</body></html>`;

describe('PageInPlace', () => {
    let doc: Document;
    let host: PageInPlaceHost & { saveWords: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn>; typing: ReturnType<typeof vi.fn> };
    let inPlace: PageInPlace;
    let views: AreaView[];

    const make = (draft: PageTextDraft | null) => {
        const file = readPageFile(HTML);
        const ctx: EditorContext = { lang: 'en', defaultLang: 'en', ownFile: true, file, defaultFile: file, strings: {}, draft };
        return file.areas.map((area) => areaView(area, ctx));
    };
    const el = (key: string) => doc.querySelector<HTMLElement>(`[data-arc-edit="${key}"]`)!;
    const click = (target: Element) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const key = (name: string) => doc.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

    beforeEach(() => {
        doc = new DOMParser().parseFromString(HTML, 'text/html');
        views = make(null);
        host = {
            areaFor: (k: string) => views.find((v) => v.area.key === k) ?? null,
            saveWords: vi.fn(), open: vi.fn(), typing: vi.fn(),
            cardText: () => null, openCard: vi.fn(), saveCardText: vi.fn(), cardHover: vi.fn(),
        };
        inPlace = new PageInPlace(doc, host);
        inPlace.attach();
    });

    it('outlines what can be changed, in the frame\'s own document', () => {
        expect(doc.querySelector('style[data-arc-in-place]')?.textContent).toContain('[data-arc-edit]:not([data-arc-fixed]):hover');
        inPlace.detach();
        expect(doc.querySelector('style[data-arc-in-place]')).toBeNull();
    });

    it('tells the screen about a click that opens nothing, but not one that only finishes typing', () => {
        const fixedClick = vi.fn();
        host.fixedClick = fixedClick;
        click(doc.getElementById('plain')!);
        expect(fixedClick).toHaveBeenCalledWith(doc.getElementById('plain'), 0, 0);
        fixedClick.mockClear();
        click(el('hero'));
        click(doc.getElementById('plain')!);
        expect(fixedClick).not.toHaveBeenCalled();
    });

    it('marks an area the editor does not offer as fixed: no outline, and a click says so', () => {
        const fixedClick = vi.fn();
        host.fixedClick = fixedClick;
        views = views.filter((view) => view.area.key !== 'hero');
        inPlace.patch(views);
        expect(el('hero').hasAttribute('data-arc-fixed')).toBe(true);
        expect(el('intro').hasAttribute('data-arc-fixed')).toBe(false);
        click(el('hero'));
        expect(host.typing).not.toHaveBeenCalled();
        expect(fixedClick).toHaveBeenCalledWith(el('hero'), 0, 0);
    });

    it('types words in place, and Enter saves them (VE-D37)', () => {
        click(el('hero'));
        expect(el('hero').getAttribute('contenteditable')).toBe('plaintext-only');
        expect(host.typing).toHaveBeenLastCalledWith(views[0], el('hero'));
        el('hero').textContent = 'Hi   all ';
        key('Enter');
        expect(host.saveWords).toHaveBeenCalledWith(views[0], 'Hi all');
        expect(el('hero').hasAttribute('contenteditable')).toBe(false);
        expect(host.typing).toHaveBeenLastCalledWith(null, null);
    });

    it('Escape puts back what was there and saves nothing', () => {
        click(el('hero'));
        el('hero').textContent = 'Oops';
        key('Escape');
        expect(el('hero').textContent).toBe('Hello');
        expect(host.saveWords).not.toHaveBeenCalled();
    });

    it('saves nothing when the words did not change, and saves on a click elsewhere when they did', () => {
        click(el('hero'));
        click(doc.body);
        expect(host.saveWords).not.toHaveBeenCalled();
        click(el('hero'));
        el('hero').textContent = 'Changed';
        click(doc.body);
        expect(host.saveWords).toHaveBeenCalledWith(views[0], 'Changed');
    });

    it('keeps only bold, italic and links of rich text', () => {
        click(el('intro'));
        expect(el('intro').getAttribute('contenteditable')).toBe('true');
        el('intro').innerHTML = 'New <b>bold</b> <span onclick="x()">words</span><script>alert(1)</script>';
        inPlace.done();
        expect(host.saveWords).toHaveBeenCalledWith(views[1], 'New <b>bold</b> wordsalert(1)');
    });

    it('opens the box for a picture or background, and for a link\'s address beside its words', () => {
        click(el('photo'));
        expect(host.open).toHaveBeenLastCalledWith(views[2], el('photo'));
        click(el('band'));
        expect(host.open).toHaveBeenLastCalledWith(views[4], el('band'));
        click(el('cta'));
        expect(host.open).toHaveBeenLastCalledWith(views[3], el('cta'));
        expect(el('cta').getAttribute('contenteditable')).toBe('plaintext-only');
    });

    it('never follows a link on the page', () => {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        doc.getElementById('plain')!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it('puts saved values on the page, never into the area being typed in (VE-D52)', () => {
        click(el('hero'));
        el('hero').textContent = 'Typing';
        views = make({
            text: { en: { hero: { value: 'From someone else' }, intro: { value: 'Hi <i>there</i><img src=x onerror=1>' }, photo: { value: 'New alt' }, cta: { value: 'Order' } } },
            urls: { photo: { value: '/b.jpg' }, cta: { value: 'javascript:alert(1)' }, band: { value: '/band.jpg' } },
        });
        inPlace.patch(views);
        expect(el('hero').textContent).toBe('Typing');
        expect(el('intro').innerHTML).toBe('Hi <i>there</i>');
        expect(el('photo').getAttribute('src')).toBe('/b.jpg');
        expect(el('photo').hasAttribute('srcset')).toBe(false);
        // A lazy-loading script's copy takes the new address too, or it brings the old picture back.
        expect(el('photo').getAttribute('data-src')).toBe('/b.jpg');
        expect(el('photo').hasAttribute('data-srcset')).toBe(false);
        expect(el('photo').getAttribute('alt')).toBe('New alt');
        // An address that is not safe never reaches the page: the file's stays.
        expect(el('cta').getAttribute('href')).toBe('/menu');
        expect(el('cta').textContent).toBe('Order');
        expect(el('band').getAttribute('style')).toBe('color: red; background-image: url("/band.jpg")');
    });

    it('reads what was typed as plain text or allowed rich text', () => {
        const div = doc.createElement('div');
        div.innerHTML = ' A <b>b</b>\n c ';
        expect(typedValue(views[0], div)).toBe('A b c');
        expect(typedValue(views[1], div)).toBe('A <b>b</b>\n c');
    });

    it('points the frame at the page\'s Live Preview in edit mode', () => {
        expect(pageEditFrameUrl('', 'en', 'en')).toBe('/admin/preview-page/home?edit=1');
        expect(pageEditFrameUrl('', 'hi', 'en')).toBe('/admin/preview-page/home/hi?edit=1');
        expect(pageEditFrameUrl('about-us', 'en', 'en')).toBe('/admin/preview-page/p/about-us?edit=1');
    });
});

/** Cards in a card block, edited like an entry (VE-D54); not in the header or footer (VE-D20). */
describe('PageInPlace on cards', () => {
    const CARDS = `<html><head></head><body>
<arc-content-partials content-type="quotes" data-arc-edit="quotes_title"><h2>Quotes</h2><div>
<article data-arc-field="items" data-arc-row="0" data-arc-card-id="q1" data-arc-card-type="quotes">
  <h3 data-arc-field="items" data-arc-sub="title">Kind words</h3>
  <p data-arc-field="items" data-arc-sub="excerpt">An excerpt</p>
  <img data-arc-field="items" data-arc-sub="coverImage" data-arc-field-attr="src" src="/q.jpg">
</article>
<article data-arc-field="items" data-arc-row="1" data-arc-card-id="q2" data-arc-card-type="quotes" data-arc-leaving><h3 data-arc-sub="title">Old</h3></article>
</div></arc-content-partials>
<arc-footer><article data-arc-card-id="f1" data-arc-card-type="quotes"><h3 data-arc-sub="title">Footer</h3></article></arc-footer>
</body></html>`;
    let doc: Document;
    let host: PageInPlaceHost & Record<string, ReturnType<typeof vi.fn>>;
    const click = (target: Element) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const q = (selector: string) => doc.querySelector<HTMLElement>(selector)!;

    beforeEach(() => {
        doc = new DOMParser().parseFromString(CARDS, 'text/html');
        host = {
            areaFor: vi.fn(() => null), saveWords: vi.fn(), open: vi.fn(), typing: vi.fn(),
            cardText: vi.fn((_card, sub: string) => (sub === 'title' ? 'title' : null)),
            openCard: vi.fn(), saveCardText: vi.fn(), cardHover: vi.fn(),
        } as any;
        new PageInPlace(doc, host).attach();
    });

    it('a click on the block outside its cards opens its section title, one on a card is the card\'s', () => {
        click(q('arc-content-partials h2'));
        expect(host['open']).not.toHaveBeenCalled();
        expect(host['areaFor']).toHaveBeenCalledWith('quotes_title');
        click(q('[data-arc-card-id="q1"] p'));
        expect(host['openCard']).toHaveBeenCalled();
        expect(host['areaFor']).toHaveBeenCalledTimes(1);
    });

    it('finds a card outside the header and footer only', () => {
        expect(cardOf(q('[data-arc-card-id="q1"] h3'))?.card).toEqual({ type: 'quotes', id: 'q1' });
        expect(cardOf(q('[data-arc-card-id="f1"] h3'))).toBeNull();
    });

    it('types a card\'s title in place, opens its form, and saves on Done', () => {
        const title = q('[data-arc-card-id="q1"] h3');
        click(title);
        expect(title.getAttribute('contenteditable')).toBe('plaintext-only');
        expect(host['openCard']).toHaveBeenCalledWith({ type: 'quotes', id: 'q1' }, null, true);
        expect(host['typing']).toHaveBeenLastCalledWith(null, title);
        title.textContent = '  Very   kind words ';
        doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(host['saveCardText']).toHaveBeenCalledWith({ type: 'quotes', id: 'q1' }, 'title', 'Very kind words');
        expect(title.hasAttribute('contenteditable')).toBe(false);
    });

    it('saves nothing when the words did not change, and Escape puts them back', () => {
        const title = q('[data-arc-card-id="q1"] h3');
        click(title);
        doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(host['saveCardText']).not.toHaveBeenCalled();
        click(title);
        title.textContent = 'Gone';
        doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(title.textContent).toBe('Kind words');
        expect(host['saveCardText']).not.toHaveBeenCalled();
    });

    it('opens the form on the field for a value not typed in place, and for a picture', () => {
        click(q('[data-arc-card-id="q1"] p'));
        expect(host['openCard']).toHaveBeenLastCalledWith({ type: 'quotes', id: 'q1' }, 'excerpt');
        click(q('[data-arc-card-id="q1"] img'));
        expect(host['openCard']).toHaveBeenLastCalledWith({ type: 'quotes', id: 'q1' }, 'coverImage');
        expect(host['cardText']).not.toHaveBeenCalledWith(expect.anything(), 'coverImage');
    });

    it('a card Publish would push out is not typed in, and the footer\'s cards are left alone', () => {
        click(q('[data-arc-card-id="q2"] h3'));
        expect(q('[data-arc-card-id="q2"] h3').hasAttribute('contenteditable')).toBe(false);
        expect(host['openCard']).toHaveBeenLastCalledWith({ type: 'quotes', id: 'q2' }, 'title');
        host['openCard'].mockClear();
        click(q('[data-arc-card-id="f1"] h3'));
        expect(host['openCard']).not.toHaveBeenCalled();
    });

    it('tells the screen which card the pointer is over, for its bar', () => {
        q('[data-arc-card-id="q1"] h3').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        expect(host['cardHover']).toHaveBeenLastCalledWith(q('[data-arc-card-id="q1"]'));
        q('[data-arc-card-id="f1"] h3').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        expect(host['cardHover']).toHaveBeenLastCalledWith(null);
    });
});

describe('IN_PLACE_CSS', () => {
    it('gives an empty area a box with its placeholder, but not a picture or a background', () => {
        const doc = new DOMParser().parseFromString(`<html><head><style>${IN_PLACE_CSS}</style></head><body>
            <p id="empty" data-arc-edit="note" data-arc-placeholder="Say something"></p>
            <p id="full" data-arc-edit="hero">Hello</p>
            <img id="pic" data-arc-edit="photo" src="/a.jpg">
            <div id="band" data-arc-edit="band" data-arc-edit-kind="background"></div>
        </body></html>`, 'text/html');
        const rule = '[data-arc-edit]:not(img):not([data-arc-edit-kind="background"]):not([data-arc-editing]):empty';
        expect(IN_PLACE_CSS).toContain(`${rule}::before { content: attr(data-arc-placeholder)`);
        expect(doc.getElementById('empty')!.matches(rule)).toBe(true);
        for (const id of ['full', 'pic', 'band']) expect(doc.getElementById(id)!.matches(rule)).toBe(false);
    });
});
