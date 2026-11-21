/**
 * Editing in place (specs/visual-editing-spec.md, VE-D16): what each marked element
 * edits, and the spots' behaviour on the page: plain text typed in place, rich text
 * mounted, images, boxes and the panel, Tab in page order, Escape, links not followed,
 * and no redraw under the cursor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hintKind, InPlaceEditing, InPlaceHost, linesText, pictureAt, plainText, spotInfo, textAt, typedAsShown } from './in-place';
import { ContentType } from '../contents/content-types/content-types.model';

const TYPE = {
    slug: 'events',
    name: 'Events',
    fields: [
        { key: 'events-venue', label: 'Venue', type: 'text' },
        { key: 'events-price', label: 'Price', type: 'number' },
        { key: 'events-notes', label: 'Notes', type: 'richtext' },
        { key: 'events-poster', label: 'Poster', type: 'image' },
        { key: 'events-faq', label: 'FAQ', type: 'faq' },
        { key: 'events-link', label: 'Link', type: 'text' },
        { key: 'events-cards', label: 'Cards', type: 'infocard' },
        { key: 'events-where', label: 'Where', type: 'maplocation' },
    ],
} as unknown as ContentType;

function el(html: string): HTMLElement {
    const box = document.createElement('div');
    box.innerHTML = html;
    return box.firstElementChild as HTMLElement;
}

describe('spotInfo: what a marked element edits', () => {
    const kind = (html: string) => spotInfo(el(html), TYPE)?.kind ?? null;

    it('types the title, the summary and a text field in place', () => {
        expect(kind('<span data-arc-field="title">T</span>')).toBe('text');
        expect(kind('<p data-arc-field="summary">S</p>')).toBe('text');
        expect(kind('<span data-arc-field="venue">Hall</span>')).toBe('text');
        expect(spotInfo(el('<span data-arc-field="venue">Hall</span>'), TYPE)?.field).toBe('events-venue');
    });

    it('mounts the rich text editor on the body and a rich text field', () => {
        expect(kind('<div data-arc-field="content"></div>')).toBe('rich');
        expect(kind('<div data-arc-field="notes"></div>')).toBe('rich');
    });

    it('picks an image for the cover and an image field, in an attribute too', () => {
        expect(kind('<img data-arc-field="coverImage" data-arc-field-attr="src">')).toBe('image');
        expect(kind('<img data-arc-field="coverImage_m" data-arc-field-attr="src">')).toBe('image');
        expect(kind('<img data-arc-field="poster" data-arc-field-attr="src">')).toBe('image');
    });

    it('edits other field types, a value made from a field and a value in an attribute in a box', () => {
        expect(kind('<span data-arc-field="price">20</span>')).toBe('popover');
        expect(kind('<span data-arc-field="venue_upper">HALL</span>')).toBe('popover');
        expect(kind('<a data-arc-field="link" data-arc-field-attr="href">x</a>')).toBe('popover');
    });

    it('sends a file field\'s rows, tags and the author to the panel', () => {
        expect(kind('<li data-arc-field="faq" data-arc-row="1">Q</li>')).toBe('panel');
        expect(spotInfo(el('<li data-arc-field="faq" data-arc-row="1">Q</li>'), TYPE)?.row).toBe(1);
        expect(kind('<span data-arc-field="tags">t</span>')).toBe('panel');
        expect(kind('<span data-arc-field="authorName">A</span>')).toBe('panel');
        expect(kind('<div data-arc-field="notes" data-arc-field-attr="title"></div>')).toBe('panel');
    });

    it('leaves values the site works out, and the title or body inside an attribute', () => {
        expect(kind('<span data-arc-field="publishedOn">D</span>')).toBeNull();
        expect(kind('<span data-arc-field="author.name">A</span>')).toBeNull();
        expect(kind('<img data-arc-field="title" data-arc-field-attr="alt">')).toBeNull();
        expect(kind('<meta data-arc-field="content" data-arc-field-attr="content">')).toBeNull();
        expect(spotInfo(el('<span data-arc-field="title">T</span>'), null)).toBeNull();
    });

    it('types a row\'s words in place, an FAQ answer over several lines, and picks its picture (VE-D31)', () => {
        const info = spotInfo(el('<summary data-arc-field="faq" data-arc-sub="question" data-arc-row-id="r_a">Q</summary>'), TYPE);
        expect(info).toMatchObject({ kind: 'text', field: 'events-faq', rowId: 'r_a', sub: 'question' });
        expect(spotInfo(el('<div data-arc-field="faq" data-arc-sub="answer_html" data-arc-row-id="r_a"><p>A</p></div>'), TYPE))
            .toMatchObject({ kind: 'text', sub: 'answer', multiline: true });
        expect(kind('<img data-arc-field="cards" data-arc-sub="image" data-arc-row-id="r_c" data-arc-field-attr="src">')).toBe('image');
        expect(kind('<i data-arc-field="cards" data-arc-sub="icon" data-arc-row-id="r_c" data-arc-field-attr="class"></i>')).toBe('image');
    });

    it('opens the map box on a map row\'s map, address and directions link (VE-D34)', () => {
        const info = (html: string) => spotInfo(el(html), TYPE);
        expect(info('<p data-arc-field="where" data-arc-sub="address" data-arc-row-id="r_m">1 High St</p>')).toMatchObject({ kind: 'popover', sub: 'address', addressText: true });
        expect(info('<iframe data-arc-field="where" data-arc-sub="map_embed" data-arc-row-id="r_m"></iframe>')).toMatchObject({ kind: 'popover', addressText: false });
        expect(info('<a data-arc-field="where" data-arc-sub="map_directions" data-arc-row-id="r_m">Go</a>')?.kind).toBe('popover');
        expect(info('<h3 data-arc-field="where" data-arc-sub="label" data-arc-row-id="r_m">Shop</h3>')?.kind).toBe('text');
    });

    it('a row itself, a row value in an attribute and a value no row holds are not spots', () => {
        expect(kind('<details data-arc-field="faq" data-arc-row="0" data-arc-row-id="r_a"></details>')).toBeNull();
        expect(kind('<img data-arc-field="cards" data-arc-sub="headline" data-arc-row-id="r_c" data-arc-field-attr="alt">')).toBeNull();
        expect(kind('<span data-arc-field="faq" data-arc-sub="title" data-arc-row-id="r_a">x</span>')).toBeNull();
    });

    it('types a section heading in place (VE-D31)', () => {
        expect(spotInfo(el('<h3 data-arc-field="faq_heading">FAQ</h3>'), TYPE)).toMatchObject({ kind: 'text', field: 'events-faq', heading: true });
        expect(spotInfo(el('<h3 data-arc-field="cards_heading">x</h3>'), TYPE)?.heading).toBeFalsy();
    });

    it('keeps an FAQ answer\'s lines', () => {
        const p = el('<div>\nOne\n\nTwo\n</div>');
        expect(linesText(p)).toBe('One\n\nTwo');
    });

    it('keeps typed text on one line', () => {
        const p = el('<p>One\nTwo</p>');
        expect(plainText(p)).toBe('One Two');
    });
});

describe('InPlaceEditing', () => {
    let doc: Document;
    let frame: HTMLIFrameElement;
    let host: InPlaceHost & Record<string, ReturnType<typeof vi.fn>>;
    let editing: InPlaceEditing;
    let rich: { focus: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
    let richChange: ((html: string) => void) | null;
    const values: Record<string, unknown> = { 'events-notes': '<p>Old</p>', content: '<p>Body</p>' };

    const PAGE = `
        <h1><span data-arc-field="title">Concert</span></h1>
        <img data-arc-field="coverImage" data-arc-field-attr="src" src="/c.jpg">
        <p>Price <span data-arc-field="price">20</span></p>
        <div data-arc-field="content"><p>Body</p></div>
        <ul><li data-arc-field="faq" data-arc-row="0">Q</li></ul>
        <span data-arc-field="publishedOn">Today</span>
        <a id="out" href="/elsewhere">Elsewhere</a>`;

    beforeEach(() => {
        // A frame, as on the screen: the page's document has a window, so spots take the focus.
        frame = document.createElement('iframe');
        document.body.appendChild(frame);
        doc = frame.contentDocument!;
        doc.body.innerHTML = PAGE;
        rich = { focus: vi.fn(), destroy: vi.fn() };
        richChange = null;
        host = {
            type: vi.fn(() => TYPE),
            value: vi.fn((field: string) => values[field] ?? ''),
            setText: vi.fn(),
            setRich: vi.fn(),
            hold: vi.fn(),
            mountRich: vi.fn((el: HTMLElement, html: string, onChange: (html: string) => void) => {
                richChange = onChange;
                // As TipTap does: its own element in the spot while open, gone when destroyed.
                const editorEl = doc.createElement('div');
                editorEl.className = 'ProseMirror';
                editorEl.innerHTML = html;
                el.appendChild(editorEl);
                rich.destroy.mockImplementation(() => editorEl.remove());
                return rich;
            }),
            image: vi.fn(),
            popover: vi.fn(),
            panel: vi.fn(),
            activeChanged: vi.fn(),
            placeholder: vi.fn((field: string, label: string | null) => `Add ${label ?? field}`),
            hint: vi.fn((kind: string) => `hint:${kind}`),
        } as never;
        editing = new InPlaceEditing(doc, host);
        editing.attach();
    });

    afterEach(() => {
        editing.detach();
        frame.remove();
    });

    const q = (selector: string) => doc.querySelector(selector) as HTMLElement;
    const click = (target: Element) => {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event;
    };
    const key = (key: string, shiftKey = false) => {
        const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
        (doc.activeElement ?? doc.body).dispatchEvent(event);
        return event;
    };

    it('marks the spots with their kind and adds its styles to the page', () => {
        expect(q('[data-arc-field="title"]').getAttribute('data-arc-edit-kind')).toBe('text');
        expect(q('[data-arc-field="coverImage"]').getAttribute('data-arc-edit-kind')).toBe('image');
        expect(q('[data-arc-field="price"]').getAttribute('data-arc-edit-kind')).toBe('popover');
        expect(q('[data-arc-field="content"]').getAttribute('data-arc-edit-kind')).toBe('rich');
        expect(q('[data-arc-field="publishedOn"]').hasAttribute('data-arc-edit-kind')).toBe(false);
        expect(doc.getElementById('arc-in-place-style')!.textContent).toContain('white-space: pre-wrap');
        expect(doc.getElementById('arc-in-place-style')!.textContent).toContain('[data-arc-unhide] { display: revert !important; }');
    });

    it('types the title in place: the draft follows, the page is held, Enter is done', () => {
        const title = q('[data-arc-field="title"]');
        click(title);
        expect(title.getAttribute('contenteditable')).toMatch(/plaintext-only|true/);
        expect(title.hasAttribute('data-arc-editing')).toBe(true);
        expect(host.hold).toHaveBeenLastCalledWith(true);
        title.textContent = 'Concert night';
        title.dispatchEvent(new Event('input', { bubbles: true }));
        expect(host.setText).toHaveBeenLastCalledWith('title', 'Concert night');
        key('Enter');
        expect(title.hasAttribute('contenteditable')).toBe(false);
        expect(host.hold).toHaveBeenLastCalledWith(false);
        expect(editing.current()).toBeNull();
    });

    it('Cancel puts back what a text spot held, in the draft and on the page (VE-D37)', () => {
        const title = q('[data-arc-field="title"]');
        let storedTitle = 'Concert';
        host.value.mockImplementation((field: string) => (field === 'title' ? storedTitle : values[field] ?? ''));
        host.setText.mockImplementation((field: string, value: string) => { if (field === 'title') storedTitle = value; });
        click(title);
        title.textContent = 'Something else';
        title.dispatchEvent(new Event('input', { bubbles: true }));
        expect(host.setText).toHaveBeenLastCalledWith('title', 'Something else');
        editing.cancel();
        expect(host.setText).toHaveBeenLastCalledWith('title', 'Concert');
        expect(title.textContent).toBe('Concert');
        expect(editing.current()).toBeNull();
        expect(host.hold).toHaveBeenLastCalledWith(false);
    });

    it('Cancel on an unchanged spot writes nothing', () => {
        click(q('[data-arc-field="title"]'));
        editing.cancel();
        expect(host.setText).not.toHaveBeenCalled();
    });

    it('Cancel puts back a rich spot\'s HTML and what the page showed', () => {
        const body = q('[data-arc-field="content"]');
        click(body);
        richChange!('<p>Typed</p>');
        expect(host.setRich).toHaveBeenLastCalledWith('content', '<p>Typed</p>');
        editing.cancel();
        expect(host.setRich).toHaveBeenLastCalledWith('content', '<p>Body</p>');
        expect(body.innerHTML).toBe('<p>Body</p>');
    });

    it('an empty value keeps the page\'s layout while typed in; only one inside a line gets room for the cursor', () => {
        const css = doc.getElementById('arc-in-place-style')!.textContent!;
        expect(css).toContain('[data-arc-editing][data-arc-inline]:empty, [data-arc-editing][data-arc-inline][data-arc-unhide]:empty { display: inline-block !important; min-width: 1ch; }');
        expect(css).not.toMatch(/\[data-arc-editing\]:empty \{ display/);
        const title = q('[data-arc-field="title"]');
        title.style.display = 'inline';
        click(title);
        expect(title.hasAttribute('data-arc-inline')).toBe(true);
        key('Escape');
        const heading = q('h1');
        heading.style.display = 'block';
        heading.setAttribute('data-arc-field', 'summary');
        editing.mark();
        click(heading);
        expect(heading.hasAttribute('data-arc-inline')).toBe(false);
        key('Escape');
        expect(title.hasAttribute('data-arc-inline')).toBe(false);
    });

    it('opens the one spot of an element clicked beside it', () => {
        click(q('h1'));
        expect(editing.current()?.field).toBe('title');
    });

    it('leaves a spot on Escape, and keeps Escape from closing anything else', () => {
        click(q('[data-arc-field="title"]'));
        const outside = vi.fn();
        doc.addEventListener('keydown', outside);
        const event = key('Escape');
        expect(event.defaultPrevented).toBe(true);
        expect(outside).not.toHaveBeenCalled();
        expect(editing.current()).toBeNull();
        // With nothing open, Escape is the screen's (it closes the panel).
        key('Escape');
        expect(outside).toHaveBeenCalled();
    });

    it('mounts the rich text editor with the draft\'s HTML and writes what is typed', () => {
        const body = q('[data-arc-field="content"]');
        click(body);
        expect(host.mountRich).toHaveBeenCalledWith(body, '<p>Body</p>', expect.any(Function), { field: 'content', drawn: expect.any(Map) });
        expect(rich.focus).toHaveBeenCalled();
        expect(host.activeChanged).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'content' }), rich);
        richChange!('<p>Body, longer</p>');
        expect(host.setRich).toHaveBeenCalledWith('content', '<p>Body, longer</p>');
        click(doc.body);
        expect(rich.destroy).toHaveBeenCalled();
        expect(host.hold).toHaveBeenLastCalledWith(false);
    });

    it('puts the page back when a rich spot is left, unchanged or typed in', () => {
        const body = q('[data-arc-field="content"]');
        const drawn = body.innerHTML;
        click(body);
        expect(body.querySelector('.ProseMirror')).not.toBeNull();
        // Opened and left with nothing typed: the page never draws the same value again, so it is put back.
        click(doc.body);
        expect(body.innerHTML).toBe(drawn);
        click(body);
        richChange!('<p>Body, longer</p>');
        click(doc.body);
        // Typed in: the new text shows until the page draws it.
        expect(body.innerHTML).toBe('<p>Body, longer</p>');
    });

    it('tells the editor which text was clicked, read before the editor takes the spot', () => {
        const body = q('[data-arc-field="content"]');
        const text = body.querySelector('p')!.firstChild as Text;
        (doc as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => {
            const range = doc.createRange();
            range.setStart(text, 2);
            return range;
        };
        body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
        expect(rich.focus).toHaveBeenCalledWith({ x: 40, y: 50, text: { data: 'Body', nth: 0, offset: 2 } });
    });

    it('counts which of several pieces with the same text was clicked, and reads no text off one', () => {
        const box = doc.createElement('div');
        box.innerHTML = '<p>Same</p>\n<p><b>Same</b></p><p>Other</p>';
        doc.body.appendChild(box);
        const second = box.querySelector('b')!.firstChild as Text;
        const at = (node: Node, offset: number) => {
            (doc as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => {
                const range = doc.createRange();
                range.setStart(node, offset);
                return range;
            };
        };
        at(second, 3);
        expect(textAt(doc, box, { x: 1, y: 1 })).toEqual({ data: 'Same', nth: 1, offset: 3 });
        at(box.childNodes[1], 0); // the line break between blocks
        expect(textAt(doc, box, { x: 1, y: 1 })).toBeNull();
        at(q('[data-arc-field="title"]').firstChild!, 1); // outside the spot
        expect(textAt(doc, box, { x: 1, y: 1 })).toBeNull();
    });

    it('tells the editor which picture was clicked, and lets the screen close its box on Escape first', () => {
        const body = q('[data-arc-field="content"]');
        body.insertAdjacentHTML('beforeend', '<img src="/a.jpg"><img id="two" src="/a.jpg">');
        (doc as Document & { elementFromPoint: unknown }).elementFromPoint = () => q('#two');
        expect(pictureAt(doc, body, { x: 1, y: 1 })).toEqual({ src: '/a.jpg', nth: 1 });
        body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }));
        expect(rich.focus).toHaveBeenCalledWith(expect.objectContaining({ image: { src: '/a.jpg', nth: 1 } }));
        let boxOpen = true;
        (host as unknown as { escape: () => boolean }).escape = () => {
            const was = boxOpen;
            boxOpen = false;
            return was;
        };
        doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(editing.current()?.field).toBe('content');
        doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(editing.current()).toBeNull();
    });

    describe('empty fields, read-only values and template hints (VE-D17 to VE-D19)', () => {
        const add = (html: string) => {
            doc.body.insertAdjacentHTML('beforeend', html);
            editing.mark();
        };

        it('shows an empty value as a placeholder naming its field, or the template\'s label or text', () => {
            add('<span id="v" data-arc-field="venue"></span>'
                + '<div data-arc-empty="link" data-arc-label="Tickets"><a><span id="l" data-arc-field="link"></span></a></div>'
                + '<span id="p" data-arc-field="notes" data-arc-placeholder="e.g. Doors at 7"></span>');
            expect(q('#v').getAttribute('data-arc-ph')).toBe('Add events-venue');
            expect(q('#l').getAttribute('data-arc-ph')).toBe('Add Tickets');
            expect(q('#p').getAttribute('data-arc-ph')).toBe('e.g. Doors at 7');
            // Filled in: the placeholder goes.
            q('#v').textContent = 'Hall';
            editing.mark();
            expect(q('#v').hasAttribute('data-arc-ph')).toBe(false);
        });

        it('makes an empty element kept for a field with nothing to click in it that field\'s spot', () => {
            add('<div id="box" data-arc-empty="poster"><img data-arc-field="poster" data-arc-field-attr="src" src=""></div>');
            const box = q('#box');
            expect(box.getAttribute('data-arc-field')).toBe('poster');
            expect(box.getAttribute('data-arc-edit-kind')).toBe('image');
            expect(box.getAttribute('data-arc-ph')).toBe('Add events-poster');
            click(box);
            expect(host.image).toHaveBeenCalledWith(expect.objectContaining({ field: 'events-poster', el: box }));
        });

        it('says where a value the site works out comes from, and leaves a title of the template\'s own', () => {
            add('<span id="d" data-arc-field="publishedOn">Today</span><span id="t" title="Mine" data-arc-field="related_count">3</span>');
            expect(q('#d').getAttribute('title')).toBe('hint:date');
            expect(q('#t').getAttribute('title')).toBe('Mine');
            expect(hintKind('author.name')).toBe('author');
            expect(hintKind('readingTime')).toBe('reading');
            expect(hintKind('share.twitter')).toBe('site');
        });

        it('never edits a locked value, and names the header and footer', () => {
            add('<h2 data-arc-locked><span id="lk" data-arc-field="venue">Hall</span></h2><arc-header id="hd"></arc-header>');
            expect(q('#lk').hasAttribute('data-arc-edit-kind')).toBe(false);
            expect(q('#lk').getAttribute('title')).toBe('hint:locked');
            click(q('#lk'));
            expect(editing.current()).toBeNull();
            expect(q('#hd').getAttribute('title')).toBe('hint:header');
        });

        it('marks a field every language shares while a translation is on screen, and does not edit it', () => {
            add('<span id="pr2" data-arc-field="price">20</span><span id="vn" data-arc-field="venue">Hall</span>');
            (host as unknown as { shared: (field: string) => boolean }).shared = (field) => field === 'events-price';
            editing.mark();
            expect(q('#pr2').hasAttribute('data-arc-edit-kind')).toBe(false);
            expect(q('#pr2').hasAttribute('data-arc-shared')).toBe(true);
            expect(q('#pr2').getAttribute('title')).toBe('hint:shared');
            click(q('#pr2'));
            expect(host.popover).not.toHaveBeenCalled();
            expect(q('#vn').getAttribute('data-arc-edit-kind')).toBe('text');
            // Back on the default language: editable again, the mark and its title gone.
            (host as unknown as { shared: () => boolean }).shared = () => false;
            editing.mark();
            expect(q('#pr2').getAttribute('data-arc-edit-kind')).toBe('popover');
            expect(q('#pr2').hasAttribute('data-arc-shared')).toBe(false);
            expect(q('#pr2').hasAttribute('title')).toBe(false);
        });

        it('gives the popover the template\'s label', () => {
            add('<span id="pr" data-arc-field="price" data-arc-label="Ticket price">20</span>');
            click(q('#pr'));
            expect(host.popover).toHaveBeenCalledWith(expect.objectContaining({ field: 'events-price', label: 'Ticket price' }));
        });
    });

    it('hands images, boxes and the panel to the screen', () => {
        click(q('[data-arc-field="coverImage"]'));
        expect(host.image).toHaveBeenCalledWith(expect.objectContaining({ field: 'coverImage' }));
        click(q('[data-arc-field="price"]'));
        expect(host.popover).toHaveBeenCalledWith(expect.objectContaining({ field: 'events-price' }));
        click(q('[data-arc-field="faq"]'));
        expect(host.panel).toHaveBeenCalledWith(expect.objectContaining({ field: 'events-faq', row: 0 }));
    });

    it('follows no link on the page', () => {
        expect(click(q('#out')).defaultPrevented).toBe(true);
    });

    it('moves between spots in page order with Tab, opening typed ones; Enter opens one with the focus', () => {
        // jsdom lays nothing out; every spot counts as shown.
        for (const node of Array.from(doc.querySelectorAll<HTMLElement>('[data-arc-edit-kind]'))) node.getClientRects = () => [{}] as never;
        expect(key('Tab').defaultPrevented).toBe(true);
        expect(editing.current()?.field).toBe('title');
        key('Tab');
        expect(editing.current()).toBeNull();
        expect(doc.activeElement).toBe(q('[data-arc-field="coverImage"]'));
        key('Tab');
        expect(doc.activeElement).toBe(q('[data-arc-field="price"]'));
        key('Enter');
        expect(host.popover).toHaveBeenCalled();
        key('Tab');
        expect(editing.current()?.field).toBe('content');
        key('Tab', true);
        expect(doc.activeElement).toBe(q('[data-arc-field="price"]'));
    });

    it('lets Tab go on past the last spot and before the first, so the keyboard can leave the page', () => {
        for (const node of Array.from(doc.querySelectorAll<HTMLElement>('[data-arc-edit-kind]'))) node.getClientRects = () => [{}] as never;
        const spots = Array.from(doc.querySelectorAll<HTMLElement>('[data-arc-edit-kind]'));
        spots[spots.length - 1].focus();
        expect(key('Tab').defaultPrevented).toBe(false);
        spots[0].focus();
        expect(key('Tab', true).defaultPrevented).toBe(false);
    });

    it('writes nothing back when a text spot is left unchanged', () => {
        click(q('[data-arc-field="title"]'));
        host.setText.mockClear();
        key('Enter');
        expect(host.setText).not.toHaveBeenCalled();
        expect(doc.getElementById('arc-in-place-style')!.textContent).toContain('text-transform: none');
    });

    it('lets go of a spot the page drew again, and holds no redraw after it', () => {
        click(q('[data-arc-field="title"]'));
        doc.body.innerHTML = PAGE;
        editing.mark();
        expect(editing.current()).toBeNull();
        expect(host.hold).toHaveBeenLastCalledWith(false);
        expect(q('[data-arc-field="title"]').getAttribute('data-arc-edit-kind')).toBe('text');
    });

    describe('rows of a repeating field (VE-D30 to VE-D35)', () => {
        const ROWS = `
            <h3 data-arc-field="faq_heading">Questions</h3>
            <div>
              <details data-arc-field="faq" data-arc-row="0" data-arc-row-id="r_a">
                <summary data-arc-field="faq" data-arc-sub="question" data-arc-row-id="r_a">Why?</summary>
                <div data-arc-field="faq" data-arc-sub="answer_html" data-arc-row-id="r_a"><p>One.</p><p>Two.</p></div>
              </details>
              <details data-arc-field="faq" data-arc-row="1" data-arc-row-id="r_b">
                <summary data-arc-field="faq" data-arc-sub="question" data-arc-row-id="r_b"></summary>
              </details>
            </div>
            <div class="cards" data-arc-empty-loop="cards"></div>`;
        const stored: Record<string, string> = { 'r_a:question': 'Why?', 'r_a:answer': 'One.\n\nTwo.', 'heading': 'Questions' };
        let rowHost: Record<string, ReturnType<typeof vi.fn>>;

        beforeEach(() => {
            rowHost = {
                partText: vi.fn((info: { rowId?: string; sub?: string; heading?: boolean }) => (info.heading ? stored['heading'] : stored[`${info.rowId}:${info.sub}`] ?? '')),
                setPartText: vi.fn(),
                untranslated: vi.fn(() => false),
                rowHover: vi.fn(),
                emptyList: vi.fn(() => ({ text: 'Add the first card', add: true })),
                addFirst: vi.fn(),
            };
            Object.assign(host, rowHost);
            doc.body.innerHTML = ROWS;
            editing.mark();
        });

        it('opens every FAQ answer, marks the row values, and not the row itself', () => {
            expect((q('[data-arc-row-id="r_a"][data-arc-row]') as HTMLDetailsElement).open).toBe(true);
            expect(q('[data-arc-row-id="r_a"][data-arc-row]').hasAttribute('data-arc-edit-kind')).toBe(false);
            expect(q('[data-arc-row-id="r_a"][data-arc-row]').hasAttribute('title')).toBe(false);
            expect(q('summary[data-arc-row-id="r_a"]').getAttribute('data-arc-edit-kind')).toBe('text');
            expect(q('summary[data-arc-row-id="r_b"]').getAttribute('data-arc-ph')).toBe('Add events-faq');
        });

        it('types a question in place: the row is written, not a field; a click does not fold the answer', () => {
            const question = q('summary[data-arc-row-id="r_a"]');
            const event = click(question);
            expect(event.defaultPrevented).toBe(true);
            question.textContent = 'Why not?';
            question.dispatchEvent(new Event('input', { bubbles: true }));
            expect(rowHost['setPartText']).toHaveBeenLastCalledWith(expect.objectContaining({ rowId: 'r_a', sub: 'question' }), 'Why not?');
            expect(host.setText).not.toHaveBeenCalled();
            expect(click(question).defaultPrevented).toBe(true);
            expect(rowHost['rowHover']).toHaveBeenCalledWith(q('[data-arc-row-id="r_a"][data-arc-row]'));
        });

        it('types an FAQ answer as stored, over several lines, and shows its paragraphs again when left unchanged', () => {
            const answer = q('[data-arc-sub="answer_html"]');
            click(answer);
            expect(answer.textContent).toBe('One.\n\nTwo.');
            expect(answer.hasAttribute('data-arc-multiline')).toBe(true);
            expect(key('Enter').defaultPrevented).toBe(false);
            expect(editing.current()).not.toBeNull();
            key('Escape');
            expect(answer.innerHTML).toBe('<p>One.</p><p>Two.</p>');
            expect(rowHost['setPartText']).not.toHaveBeenCalled();
        });

        it('Cancel puts a row\'s word back through the row, and the screen hears of it', () => {
            Object.assign(host, { cancelled: vi.fn() });
            const question = q('summary[data-arc-row-id="r_a"]');
            click(question);
            question.textContent = 'Why not?';
            question.dispatchEvent(new Event('input', { bubbles: true }));
            rowHost['partText'].mockReturnValue('Why not?');
            editing.cancel();
            expect(rowHost['setPartText']).toHaveBeenLastCalledWith(expect.objectContaining({ rowId: 'r_a', sub: 'question' }), 'Why?');
            expect(question.textContent).toBe('Why?');
            expect((host as unknown as { cancelled: ReturnType<typeof vi.fn> }).cancelled).toHaveBeenCalledWith(expect.objectContaining({ rowId: 'r_a' }));
        });

        it('Cancel on an FAQ answer shows its paragraphs again', () => {
            const answer = q('[data-arc-sub="answer_html"]');
            click(answer);
            expect(answer.textContent).toBe('One.\n\nTwo.');
            editing.cancel();
            expect(answer.innerHTML).toBe('<p>One.</p><p>Two.</p>');
            expect(rowHost['setPartText']).not.toHaveBeenCalled();
        });

        it('types a section heading through its field', () => {
            const heading = q('h3');
            click(heading);
            heading.textContent = 'Asked often';
            heading.dispatchEvent(new Event('input', { bubbles: true }));
            expect(rowHost['setPartText']).toHaveBeenLastCalledWith(expect.objectContaining({ heading: true, field: 'events-faq' }), 'Asked often');
        });

        it('an empty list says how to add its first row, and adds it when clicked', () => {
            const list = q('[data-arc-empty-loop]');
            expect(list.getAttribute('data-arc-ph')).toBe('Add the first card');
            expect(list.getAttribute('data-arc-edit-kind')).toBe('add');
            click(list);
            expect(rowHost['addFirst']).toHaveBeenCalledWith('events-cards');
        });

        it('in a translation an empty list only says where rows are added', () => {
            rowHost['emptyList'].mockReturnValue({ text: 'Add and arrange rows in English', add: false });
            editing.mark();
            const list = q('[data-arc-empty-loop]');
            expect(list.hasAttribute('data-arc-edit-kind')).toBe(false);
            expect(list.getAttribute('title')).toBe('Add and arrange rows in English');
            click(list);
            expect(rowHost['addFirst']).not.toHaveBeenCalled();
        });

        it('a value not translated yet is faint, and typed in from empty with the default words as its placeholder', () => {
            rowHost['untranslated'].mockReturnValue(true);
            rowHost['partText'].mockReturnValue('');
            host.placeholder.mockReturnValue('Why?');
            editing.mark();
            const question = q('summary[data-arc-row-id="r_a"]');
            expect(question.hasAttribute('data-arc-untranslated')).toBe(true);
            click(question);
            expect(question.textContent).toBe('');
            expect(question.getAttribute('data-arc-ph')).toBe('Why?');
            question.textContent = 'क्यों?';
            question.dispatchEvent(new Event('input', { bubbles: true }));
            expect(question.hasAttribute('data-arc-ph')).toBe(false);
        });

        it('opens a row just added once the page draws it', () => {
            editing.openWhenDrawn('r_new');
            expect(editing.current()).toBeNull();
            doc.body.insertAdjacentHTML('beforeend', '<details data-arc-field="faq" data-arc-row="2" data-arc-row-id="r_new"><summary data-arc-field="faq" data-arc-sub="question" data-arc-row-id="r_new"></summary></details>');
            editing.mark();
            expect(editing.current()).toMatchObject({ rowId: 'r_new', sub: 'question' });
        });

        it('offers no row bar inside text being typed in (a placed field\'s card there)', () => {
            const box = doc.createElement('div');
            box.setAttribute('data-arc-editing', '');
            box.innerHTML = '<details data-arc-field="faq" data-arc-row="0" data-arc-row-id="r_x"><summary data-arc-field="faq" data-arc-sub="question" data-arc-row-id="r_x">Q</summary></details>';
            doc.body.appendChild(box);
            q('summary[data-arc-row-id="r_a"]').dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
            box.querySelector('summary')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
            expect(rowHost['rowHover']).toHaveBeenLastCalledWith(null);
        });

        it('a space typed in a question is text, and does not fold its answer', () => {
            const question = q('summary[data-arc-row-id="r_a"]');
            click(question);
            const exec = vi.fn();
            (doc as unknown as { execCommand: typeof exec }).execCommand = exec;
            expect(key(' ').defaultPrevented).toBe(true);
            expect(exec).toHaveBeenCalledWith('insertText', false, ' ');
        });

        it('a click on a map in a row opens its box, though the map takes no clicks itself', () => {
            doc.body.insertAdjacentHTML('beforeend', '<article data-arc-field="where" data-arc-row="0" data-arc-row-id="r_m"><iframe data-arc-field="where" data-arc-sub="map_embed" data-arc-row-id="r_m"></iframe></article>');
            editing.mark();
            const map = q('iframe[data-arc-sub]');
            expect(map.getAttribute('data-arc-edit-kind')).toBe('popover');
            map.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }) as DOMRect;
            const article = q('article');
            article.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
            expect(host.popover).toHaveBeenCalledWith(expect.objectContaining({ sub: 'address', rowId: 'r_m' }));
        });

        it('a click on something drawn over a map (a sticky header) does not open the map box', () => {
            doc.body.insertAdjacentHTML('beforeend', '<article data-arc-field="where" data-arc-row="0" data-arc-row-id="r_m"><iframe data-arc-field="where" data-arc-sub="map_embed" data-arc-row-id="r_m"></iframe></article><header id="bar">Menu</header>');
            editing.mark();
            q('iframe[data-arc-sub]').getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }) as DOMRect;
            q('#bar').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
            expect(host.popover).not.toHaveBeenCalled();
        });

        it('shows an empty spot the site hides only for being empty, and leaves one hidden on purpose', () => {
            const style = doc.createElement('style');
            style.textContent = '.loc h4:empty { display: none; } .d-none { display: none !important; }';
            doc.head.appendChild(style);
            doc.body.insertAdjacentHTML('beforeend', '<article class="loc" data-arc-field="where" data-arc-row="0" data-arc-row-id="r_m"><h4 data-arc-field="where" data-arc-sub="label" data-arc-row-id="r_m"></h4><p class="d-none" data-arc-field="where" data-arc-sub="label" data-arc-row-id="r_m"></p></article>');
            editing.mark();
            expect(q('h4[data-arc-sub]').hasAttribute('data-arc-unhide')).toBe(true);
            expect(q('p.d-none').hasAttribute('data-arc-unhide')).toBe(false);
        });

        it('in a translation a map row\'s address is typed in place (VE-D35)', () => {
            Object.assign(host, { translating: vi.fn(() => true) });
            doc.body.insertAdjacentHTML('beforeend', '<article data-arc-field="where" data-arc-row="0" data-arc-row-id="r_m"><p data-arc-field="where" data-arc-sub="address" data-arc-row-id="r_m">1 High St</p></article>');
            editing.mark();
            expect(q('p[data-arc-sub="address"]').getAttribute('data-arc-edit-kind')).toBe('text');
        });

        it('tells the screen which row the pointer is on', () => {
            q('summary[data-arc-row-id="r_b"]').dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
            expect(rowHost['rowHover']).toHaveBeenLastCalledWith(q('[data-arc-row-id="r_b"][data-arc-row]'));
            q('h3').dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
            expect(rowHost['rowHover']).toHaveBeenLastCalledWith(null);
        });

        it('after a row is removed, shows no row\'s bar until the pointer moves (review L)', () => {
            const at = (x: number, y: number) => new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y });
            editing.holdRowsUntilMoved();
            rowHost['rowHover'].mockClear();
            const next = q('summary[data-arc-row-id="r_b"]');
            // The page drawn again under a still pointer: the row under it gets no bar.
            next.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 50, clientY: 50 }));
            next.dispatchEvent(at(52, 51));
            expect(rowHost['rowHover']).not.toHaveBeenCalled();
            // The pointer moves on: the bar of the row it is on shows.
            next.dispatchEvent(at(70, 60));
            expect(rowHost['rowHover']).toHaveBeenLastCalledWith(q('[data-arc-row-id="r_b"][data-arc-row]'));
        });

        it('finds a spot again by its mark when the page was drawn again (review L1)', () => {
            const question = q('summary[data-arc-row-id="r_a"]');
            const info = (editing as any).spotAt(question);
            expect(info?.rowId).toBe('r_a');
            expect(editing.find(info)?.el).toBe(question);
            doc.body.innerHTML = ROWS;
            editing.mark();
            const again = editing.find(info);
            expect(again?.el).toBe(q('summary[data-arc-row-id="r_a"]'));
            expect(again?.el).not.toBe(question);
            expect(editing.find({ ...info, rowId: 'r_gone' })).toBeNull();
        });
    });

    it('waits for the type before marking', async () => {
        host.type.mockReturnValue(null as never);
        doc.body.innerHTML = PAGE;
        editing.mark();
        expect(q('[data-arc-field="title"]').hasAttribute('data-arc-edit-kind')).toBe(false);
        host.type.mockReturnValue(TYPE as never);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(q('[data-arc-field="title"]').getAttribute('data-arc-edit-kind')).toBe('text');
    });
});

describe('typing only where the page shows the stored words (review H1, M4, M5, M6)', () => {
    let doc: Document;
    let frame: HTMLIFrameElement;
    let host: InPlaceHost & Record<string, ReturnType<typeof vi.fn>>;
    let editing: InPlaceEditing;
    let translating = false;
    const values: Record<string, unknown> = {};

    beforeEach(() => {
        frame = document.createElement('iframe');
        document.body.appendChild(frame);
        doc = frame.contentDocument!;
        translating = false;
        for (const k of Object.keys(values)) delete values[k];
        host = {
            type: vi.fn(() => TYPE),
            value: vi.fn((field: string) => values[field] ?? ''),
            setText: vi.fn(),
            setRich: vi.fn(),
            hold: vi.fn(),
            mountRich: vi.fn(),
            image: vi.fn(),
            popover: vi.fn(),
            panel: vi.fn(),
            activeChanged: vi.fn(),
            translating: vi.fn(() => translating),
            placeholder: vi.fn((field: string, label: string | null) => `Add ${label ?? field}`),
            hint: vi.fn((kind: string) => `hint:${kind}`),
            fieldName: vi.fn((info: { field: string }, label: string | null) => label ?? `Name of ${info.field}`),
        } as never;
        editing = new InPlaceEditing(doc, host);
    });

    afterEach(() => {
        editing.detach();
        frame.remove();
    });

    const page = (html: string) => {
        doc.body.innerHTML = html;
        editing.attach();
        for (const node of Array.from(doc.querySelectorAll<HTMLElement>('[data-arc-edit-kind]'))) node.getClientRects = () => [{}] as never;
    };
    const q = (selector: string) => doc.querySelector(selector) as HTMLElement;
    const click = (target: Element) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const key = (name: string, shiftKey = false) => {
        const event = new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true });
        (doc.activeElement ?? doc.body).dispatchEvent(event);
        return event;
    };

    it('tells the screen about a click that opens nothing, but not one that only finishes typing', () => {
        values['events-venue'] = 'Hall';
        host.fixedClick = vi.fn();
        page('<p id="fixed">Words the design fixes</p><p><span data-arc-field="venue">Hall</span></p>');
        click(q('#fixed'));
        expect(host.fixedClick).toHaveBeenCalledWith(q('#fixed'), 0, 0);
        host.fixedClick.mockClear();
        click(q('[data-arc-field="venue"]'));
        expect(editing.current()?.field).toBe('events-venue');
        click(q('#fixed'));
        expect(editing.current()).toBeNull();
        expect(host.fixedClick).not.toHaveBeenCalled();
    });

    it('opens a text field in its box when the page shows something else: a link label, markup, a line break', () => {
        values['events-venue'] = 'https://tickets.example/hall';
        page('<p><span data-arc-field="venue">Buy tickets</span></p>');
        click(q('[data-arc-field="venue"]'));
        expect(editing.current()).toBeNull();
        expect(host.popover).toHaveBeenCalledWith(expect.objectContaining({ field: 'events-venue', kind: 'popover' }));

        values['events-venue'] = 'Fast <strong>delivery</strong>';
        page('<p><span data-arc-field="venue">Fast <strong>delivery</strong></span></p>');
        host.popover.mockClear();
        click(q('[data-arc-field="venue"]'));
        expect(host.popover).toHaveBeenCalled();
        expect(host.setText).not.toHaveBeenCalled();
    });

    it('sends the summary with line breaks to Page settings, and types one shown as stored', () => {
        values['summary'] = 'One\nTwo';
        page('<p data-arc-field="summary">One\nTwo</p>');
        click(q('[data-arc-field="summary"]'));
        expect(host.panel).toHaveBeenCalledWith(expect.objectContaining({ field: 'summary' }));
        values['summary'] = 'Short  and   plain';
        page('<p data-arc-field="summary">Short and plain</p>');
        click(q('[data-arc-field="summary"]'));
        expect(editing.current()?.field).toBe('summary');
    });

    it('in a translation, starts a title and a text field not translated yet from empty, the default words faint', () => {
        translating = true;
        page('<h1><span data-arc-field="title">Concert</span></h1><span data-arc-field="venue">Hall</span>');
        expect(q('[data-arc-field="venue"]').hasAttribute('data-arc-untranslated')).toBe(false);
        click(q('[data-arc-field="title"]'));
        expect(q('[data-arc-field="title"]').textContent).toBe('');
        expect(q('[data-arc-field="title"]').getAttribute('data-arc-ph')).toBe('Add title');
        // Left untouched: the default language's words come back and nothing is written.
        key('Enter');
        expect(q('[data-arc-field="title"]').textContent).toBe('Concert');
        expect(host.setText).not.toHaveBeenCalled();
        click(q('[data-arc-field="venue"]'));
        expect(editing.current()?.field).toBe('events-venue');
        expect(q('[data-arc-field="venue"]').textContent).toBe('');
    });

    it('tabs from a header link to the next spot, and from the footer out of the page', () => {
        page('<header><a id="home" href="/">Home</a></header><span data-arc-field="title">T</span>'
            + '<span data-arc-field="price">5</span><footer><a id="foot" href="/x">X</a></footer>');
        q('#home').focus();
        expect(key('Tab').defaultPrevented).toBe(true);
        expect(editing.current()?.field).toBe('title');
        key('Escape');
        q('#foot').focus();
        expect(key('Tab').defaultPrevented).toBe(false);
        expect(key('Tab', true).defaultPrevented).toBe(true);
        expect(doc.activeElement).toBe(q('[data-arc-field="price"]'));
        q('#home').focus();
        expect(key('Tab', true).defaultPrevented).toBe(false);
    });

    it('names each spot for a screen reader: a button while waiting, a text box while typed in', () => {
        values['title'] = 'Concert';
        page('<span data-arc-field="title">Concert</span><span data-arc-field="price">5</span>');
        expect(q('[data-arc-field="title"]').getAttribute('role')).toBe('button');
        expect(q('[data-arc-field="title"]').getAttribute('aria-label')).toBe('Name of title: Concert');
        click(q('[data-arc-field="title"]'));
        expect(q('[data-arc-field="title"]').getAttribute('role')).toBe('textbox');
        expect(q('[data-arc-field="title"]').getAttribute('aria-label')).toBe('Name of title');
    });

    it('decides "typed as shown" on the words, never the spacing', () => {
        expect(typedAsShown('A  b', ' A b ')).toBe(true);
        expect(typedAsShown('A\nb', 'A b')).toBe(false);
        expect(typedAsShown('a<br>b', 'ab')).toBe(false);
        expect(typedAsShown('', '')).toBe(true);
    });
});
