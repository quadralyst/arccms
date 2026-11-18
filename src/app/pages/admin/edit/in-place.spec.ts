/**
 * Editing in place (specs/visual-editing-spec.md, VE-D16): what each marked element
 * edits, and the spots' behaviour on the page: plain text typed in place, rich text
 * mounted, images, boxes and the panel, Tab in page order, Escape, links not followed,
 * and no redraw under the cursor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InPlaceEditing, InPlaceHost, plainText, spotInfo } from './in-place';
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
            mountRich: vi.fn((_el: HTMLElement, _html: string, onChange: (html: string) => void) => {
                richChange = onChange;
                return rich;
            }),
            image: vi.fn(),
            popover: vi.fn(),
            panel: vi.fn(),
            activeChanged: vi.fn(),
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
