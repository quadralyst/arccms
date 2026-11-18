/**
 * Editing in place (specs/visual-editing-spec.md, VE-D16): what each marked element
 * edits, and the spots' behaviour on the page: plain text typed in place, rich text
 * mounted, images, boxes and the panel, Tab in page order, Escape, links not followed,
 * and no redraw under the cursor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hintKind, InPlaceEditing, InPlaceHost, plainText, spotInfo, textAt } from './in-place';
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

    it('sends repeating rows, tags and the author to the panel', () => {
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
        expect(host.mountRich).toHaveBeenCalledWith(body, '<p>Body</p>', expect.any(Function));
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

    it('lets go of a spot the page drew again, and holds no redraw after it', () => {
        click(q('[data-arc-field="title"]'));
        doc.body.innerHTML = PAGE;
        editing.mark();
        expect(editing.current()).toBeNull();
        expect(host.hold).toHaveBeenLastCalledWith(false);
        expect(q('[data-arc-field="title"]').getAttribute('data-arc-edit-kind')).toBe('text');
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
