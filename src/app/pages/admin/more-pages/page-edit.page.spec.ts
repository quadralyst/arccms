/**
 * The page's Visual Editor with cards (page-edit.page.ts, specs/visual-editing-spec.md
 * VE-D53, VE-D54): the cards read from the frame's marks, the count on Publish, and
 * the one Publish checking every changed card first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import PageEditPage, { listDrawn, listReplaced, pageCardsIn, pageEditFrameUrl, pageLivePreviewUrl, pageValuesHaveReplace, siteAddressOpenedFrom } from './page-edit.page';
import { PageCardActions } from './page-card-actions';
import { NotifyService } from '../../../../shared/services/notify.service';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { ContentTypesStore } from '../contents/content-types/content-types.store';
import { ContentsService } from '../contents/content-store/published-contents.service';
import { EMPTY, Subject } from 'rxjs';

describe('pageCardsIn', () => {
    const doc = new DOMParser().parseFromString(`<body>
        <div data-arc-card-id="a" data-arc-card-type="quotes" data-arc-changed></div>
        <div data-arc-card-id="b" data-arc-card-type="quotes"></div>
        <div data-arc-card-id="c" data-arc-card-type="quotes" data-arc-leaving></div>
        <div data-arc-card-id="b" data-arc-card-type="quotes" data-arc-changed></div>
        <arc-footer><div data-arc-card-id="f" data-arc-card-type="quotes" data-arc-changed></div></arc-footer>
    </body>`, 'text/html');

    it('reads each card once, outside the footer, changed if any copy of it is', () => {
        expect(pageCardsIn(doc)).toEqual([
            { type: 'quotes', id: 'a', changed: true, leaving: false },
            { type: 'quotes', id: 'b', changed: true, leaving: false },
            { type: 'quotes', id: 'c', changed: false, leaving: true },
        ]);
    });
});

describe('siteAddressOpenedFrom, where Close goes back to', () => {
    const origin = 'https://example.org';

    it('is the site page the editor was opened from', () => {
        expect(siteAddressOpenedFrom('https://example.org/', origin)).toBe('/');
        expect(siteAddressOpenedFrom('https://example.org/pages/about?x=1', origin)).toBe('/pages/about?x=1');
    });

    it('is empty from an admin page, another site, no referrer or nonsense', () => {
        expect(siteAddressOpenedFrom('https://example.org/admin/more-pages', origin)).toBe('');
        expect(siteAddressOpenedFrom('https://example.org/admin', origin)).toBe('');
        expect(siteAddressOpenedFrom('https://other.org/', origin)).toBe('');
        expect(siteAddressOpenedFrom('', origin)).toBe('');
        expect(siteAddressOpenedFrom('not a url', origin)).toBe('');
    });
});

describe('the frame and Live Preview addresses', () => {
    it('opens the page in the language on screen; Live Preview with the changed cards, the frame for editing', () => {
        expect(pageEditFrameUrl({ kind: 'home', name: '' }, 'en', 'en')).toBe('/admin/preview-page/home?edit=1');
        expect(pageLivePreviewUrl({ kind: 'home', name: '' }, 'en', 'en')).toBe('/admin/preview-page/home?cards=1');
        expect(pageLivePreviewUrl({ kind: 'home', name: '' }, 'hi', 'en')).toBe('/admin/preview-page/home/hi?cards=1');
        expect(pageEditFrameUrl({ kind: 'list', name: 'articles' }, 'hi', 'en')).toBe('/admin/preview-page/list/articles/hi?edit=1');
        expect(pageLivePreviewUrl({ kind: 'list', name: 'articles' }, 'en', 'en')).toBe('/admin/preview-page/list/articles?cards=1');
        // A static page is in the default language only.
        expect(pageLivePreviewUrl({ kind: 'static', name: 'about us' }, 'hi', 'en')).toBe('/admin/preview-page/p/about%20us?cards=1');
    });
});

describe('pageValuesHaveReplace', () => {
    it('looks at saved values only, not the file\'s words kept beside them', () => {
        expect(pageValuesHaveReplace({ text: { en: { hero: { value: '[Replace: a heading]' } } } })).toBe(true);
        expect(pageValuesHaveReplace({ seo: { en: { title: { value: '[Replace: title]' } } } })).toBe(true);
        expect(pageValuesHaveReplace({ text: { en: { hero: { value: 'Done', fileText: '[Replace: a heading]' } } } })).toBe(false);
        expect(pageValuesHaveReplace(null)).toBe(false);
    });
});

describe('PageEditPage, the one Publish (VE-D53)', () => {
    let page: PageEditPage;
    let actions: { read: ReturnType<typeof vi.fn>; publish: ReturnType<typeof vi.fn> };
    let notify: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };
    let confirm: { ask: ReturnType<typeof vi.fn> };
    const quotes = { slug: 'quotes', name: 'Quotes', hasPublicUrl: false, fields: [{ key: 'person', label: 'Person', type: 'text', required: true }] };
    const drafts: Record<string, Record<string, any>> = {};
    let deploys: Record<string, Subject<any>> = {};
    const pollDeployStatus = vi.fn((id: string, _type: string) => (deploys[id] = new Subject<any>()));

    beforeEach(() => {
        deploys = {};
        for (const key of Object.keys(drafts)) delete drafts[key];
        actions = { read: vi.fn(async (card: { id: string }) => drafts[card.id] ?? null), publish: vi.fn(async () => true) };
        notify = { error: vi.fn(), success: vi.fn() };
        confirm = { ask: vi.fn(async () => true) };
        TestBed.configureTestingModule({
            imports: [PageEditPage],
            providers: [
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: MatDialog, useValue: {} },
                { provide: PageCardActions, useValue: actions },
                { provide: NotifyService, useValue: notify },
                { provide: ConfirmService, useValue: confirm },
                { provide: ContentTypesStore, useValue: { items: signal([quotes]), getAll: vi.fn() } },
                { provide: ContentsService, useValue: { pollDeployStatus } },
            ],
        });
        TestBed.overrideComponent(PageEditPage, { set: { template: '', imports: [] } });
        page = TestBed.createComponent(PageEditPage).componentInstance;
    });

    it('Live Preview opens the page\'s own window, the one the classic editor uses', () => {
        const win = { focus: vi.fn() };
        const open = vi.spyOn(window, 'open').mockReturnValue(win as never);
        page.openPreview();
        expect(open).toHaveBeenCalledWith('/admin/preview-page/home?cards=1', 'arc-page-preview-home');
        expect(win.focus).toHaveBeenCalled();
        open.mockRestore();
    });

    it('says Not saved, never Published, when what was saved for the page could not be read (review L)', () => {
        expect(page.status()).toBe('published');
        (page.data as any).sessionRef.set({ error: signal('Missing or insufficient permissions.'), draft: signal(null), close: vi.fn() });
        expect(page.status()).toBe('not_saved');
    });

    const changed = (...ids: string[]) => page.cards.set(ids.map((id) => ({ type: 'quotes', id, changed: true, leaving: false })));

    it('checks every changed card, then publishes each', async () => {
        drafts['a'] = { id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'A', customFields: { person: 'Asha' } };
        drafts['b'] = { id: 'b', status: 'draft', publishedStatus: false, addedOnPage: 'home', title: 'B', customFields: { person: 'Ravi' } };
        changed('a', 'b');
        expect(await page.beforePublish()).toBe(true);
        await page.publishWith();
        expect(actions.publish).toHaveBeenCalledTimes(2);
        expect(actions.publish).toHaveBeenCalledWith({ type: 'quotes', id: 'a' }, drafts['a'], expect.anything());
        expect(notify.success).toHaveBeenCalledWith('admin.edit_page.cards_published', { count: 2 });
    });

    describe('Review of your own changes (VE-D80)', () => {
        const open = vi.fn(async (..._args: any[]) => undefined);
        const screen = () => open.mock.calls[open.mock.calls.length - 1][2];
        beforeEach(() => {
            open.mockClear();
            (page as any).reviews = { open };
        });

        it('lists exactly the cards Publish sends, with what is typed saved first', async () => {
            drafts['a'] = { id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'First' };
            drafts['b'] = { id: 'b', status: 'draft', publishedStatus: true, changedOnPage: 'p-about', title: 'Elsewhere' };
            drafts['c'] = { id: 'c', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'Just typed' };
            page.cards.set(['a', 'b', 'c'].map((id) => ({ type: 'quotes', id, changed: id !== 'c', leaving: false })));
            // The open card, saved by the review before the frame marks it.
            page.card.set({ type: 'quotes', id: 'c' });
            const editor = { hasUnsavedChanges: vi.fn(() => true), saveAsDraft: vi.fn(async () => { editor.hasUnsavedChanges.mockReturnValue(false); }) };
            (page as any).cardEditor = () => editor;
            (page as any).panelRef = () => ({ flush: async () => true });
            page.review();
            expect(await screen().flush()).toBe(true);
            expect(editor.saveAsDraft).toHaveBeenCalled();
            expect(await screen().ownCards()).toEqual([
                { type: 'quotes', id: 'a', name: 'Quotes: First', take: true }, { type: 'quotes', id: 'c', name: 'Quotes: Just typed', take: true },
            ]);
            expect(screen().cards).toEqual([]);
        });

        it('reads nothing when a card\'s words could not be saved', async () => {
            page.card.set({ type: 'quotes', id: 'a' });
            (page as any).cardEditor = () => ({ hasUnsavedChanges: () => true, saveAsDraft: async () => undefined });
            page.review();
            expect(await screen().flush()).toBe(false);
        });

        it('waits for words still being put into a card\'s form', async () => {
            (page as any).panelRef = () => ({ flush: async () => true });
            let done: () => void = () => undefined;
            (page as any).cardSaves.add(new Promise<void>((resolve) => (done = resolve)));
            page.review();
            let answered = false;
            const flushed = screen().flush().then(() => (answered = true));
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(answered).toBe(false);
            done();
            await flushed;
        });

        it('opens a card from the list', () => {
            page.review();
            const openCard = vi.spyOn(page, 'openCard').mockImplementation(() => undefined);
            screen().showCard({ type: 'quotes', id: 'a', name: 'Quotes: First', take: true });
            expect(openCard).toHaveBeenCalledWith({ type: 'quotes', id: 'a' }, null);
        });
    });

    it('is Publishing until every card sent is on the site, and says which is not', async () => {
        for (const id of ['a', 'b', 'c']) drafts[id] = { id, status: 'draft', publishedStatus: true, changedOnPage: 'home', title: `Card ${id}`, customFields: { person: 'Asha' } };
        changed('a', 'b', 'c');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await page.beforePublish();
        await page.publishWith();
        expect([...page.cardsGoing().keys()]).toEqual(['quotes/a', 'quotes/b', 'quotes/c']);
        // Still being built.
        deploys['a'].next({ deployStatus: null });
        expect(page.cardsGoing().size).toBe(3);
        deploys['a'].next({ deployStatus: 'deployed' });
        deploys['b'].next({ deployStatus: 'failed', deployErrorCode: 'X' });
        expect(notify.error).toHaveBeenCalledWith('admin.edit_page.card_not_live', { card: 'Card b' });
        expect([...page.cardsGoing().keys()]).toEqual(['quotes/c']);
        // Published again meanwhile: the new one counts, and leaving the screen stops it.
        const first = deploys['c'];
        changed('c');
        await page.beforePublish();
        await page.publishWith();
        expect(first.observed).toBe(false);
        expect(page.cardsGoing().size).toBe(1);
        deploys['c'].next({ deployStatus: null, deployErrorCode: 'TIMEOUT' });
        expect(page.cardsGoing().size).toBe(0);
        expect(notify.error).toHaveBeenLastCalledWith('admin.edit_page.card_not_live', { card: 'Card c' });
        await page.beforePublish();
        await page.publishWith();
        page.ngOnDestroy();
        expect(deploys['c'].observed).toBe(false);
    });

    it('puts words typed on a translated page into the card\'s form, which has no title in that language yet', async () => {
        const editor = {
            contentId: 'a', publishForm: {}, pageTitle: '', createSlag: vi.fn(), triggerAutoSave: vi.fn(),
            session: { entryRead: vi.fn(() => false), activeLang: () => 'hi', editState: () => 'published' }, switchLanguage: vi.fn(),
        };
        (page as any).cardEditor = () => editor;
        page.card.set({ type: 'quotes', id: 'a' });
        page.saveCardText({ type: 'quotes', id: 'a' }, 'title', 'Hindi words');
        await new Promise((resolve) => setTimeout(resolve, 150));
        // The stored entry is not read yet: the form may still hold the one opened before.
        expect(editor.pageTitle).toBe('');
        editor.session.entryRead.mockReturnValue(true);
        await Promise.all([...(page as any).cardSaves]);
        expect(editor.pageTitle).toBe('Hindi words');
        expect(editor.triggerAutoSave).toHaveBeenCalled();
        expect(notify.error).not.toHaveBeenCalled();
    });

    it('says Saving while a card\'s words are on their way, and Not saved when they could not be', () => {
        let state = 'saving';
        (page as any).cardEditor = () => ({ session: { editState: () => state } });
        vi.useFakeTimers();
        try {
            page.card.set({ type: 'quotes', id: 'a' });
            TestBed.flushEffects();
            vi.advanceTimersByTime(300);
            expect(page.status()).toBe('saving');
            state = 'not_saved';
            vi.advanceTimersByTime(300);
            expect(page.status()).toBe('not_saved');
            // The card's own changes waiting are the page's changes: the panel says those.
            state = 'changes';
            vi.advanceTimersByTime(300);
            expect(page.status()).toBe('published');
            state = 'saving';
            vi.advanceTimersByTime(300);
            page.card.set(null);
            TestBed.flushEffects();
            expect(page.status()).toBe('published');
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('publishes nothing when a card fails, and opens that card', async () => {
        drafts['a'] = { id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'A', customFields: { person: 'Asha' } };
        drafts['b'] = { id: 'b', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'B', customFields: {} };
        changed('a', 'b');
        expect(await page.beforePublish()).toBe(false);
        expect(notify.error).toHaveBeenCalledWith('admin.edit_page.card_problem', { type: 'Quotes', field: 'Person' });
        expect(page.card()).toEqual({ type: 'quotes', id: 'b' });
        await page.publishWith();
        expect(actions.publish).not.toHaveBeenCalled();
    });

    it('asks before text still to replace goes out, and opens that card when the answer is no', async () => {
        drafts['a'] = { id: 'a', status: 'draft', publishedStatus: false, addedOnPage: 'home', title: '[Replace: new quotes]', customFields: { person: 'Asha' } };
        changed('a');
        confirm.ask.mockResolvedValueOnce(false);
        expect(await page.beforePublish()).toBe(false);
        expect(confirm.ask).toHaveBeenCalled();
        expect(page.card()).toEqual({ type: 'quotes', id: 'a' });
    });

    it('leaves out a card whose draft was published meanwhile, or added on another page', async () => {
        drafts['a'] = { id: 'a', status: 'publish', publishedStatus: true, title: 'A' };
        drafts['b'] = { id: 'b', status: 'draft', publishedStatus: false, addedOnPage: 'p-about', title: 'B' };
        changed('a', 'b');
        expect(await page.beforePublish()).toBe(true);
        await page.publishWith();
        expect(actions.publish).not.toHaveBeenCalled();
    });

    it('leaves out a card added here once but published and unpublished since', async () => {
        drafts['a'] = { id: 'a', status: 'draft', publishedStatus: false, addedOnPage: 'home', lastPublishedAt: '2026-01-02', title: 'A' };
        changed('a');
        expect(await page.beforePublish()).toBe(true);
        await page.publishWith();
        expect(actions.publish).not.toHaveBeenCalled();
    });

    it('publishes the other cards when one fails, and says which did not go out', async () => {
        drafts['a'] = { id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'First', customFields: { person: 'Asha' } };
        drafts['b'] = { id: 'b', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'Second', customFields: { person: 'Ravi' } };
        changed('a', 'b');
        actions.publish.mockImplementation(async (card: { id: string }) => {
            if (card.id === 'a') throw new Error('offline');
            return true;
        });
        expect(await page.beforePublish()).toBe(true);
        await expect(page.publishWith()).rejects.toThrow(/First/);
        expect(actions.publish).toHaveBeenCalledTimes(2);
        expect(notify.success).toHaveBeenCalledWith('admin.edit_page.cards_published_one');
    });

    it('names a card someone saved or unpublished after the check, and publishes the rest', async () => {
        drafts['a'] = { id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'Changed since', customFields: { person: 'Asha' } };
        drafts['b'] = { id: 'b', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'Second', customFields: { person: 'Ravi' } };
        changed('a', 'b');
        actions.publish.mockImplementation(async (card: { id: string }) => card.id !== 'a');
        expect(await page.beforePublish()).toBe(true);
        await expect(page.publishWith()).rejects.toThrow(/Changed since/);
        expect(notify.success).toHaveBeenCalledWith('admin.edit_page.cards_published_one');
    });
});

describe('PageEditPage, a list page (VE-D58, VE-D62, VE-D65)', () => {
    const navigate = vi.fn();
    const articles = { slug: 'articles', name: 'Articles', singularName: 'Article', fields: [], entryOrder: 'manual' };

    function make(): PageEditPage {
        navigate.mockReset();
        TestBed.configureTestingModule({
            imports: [PageEditPage],
            providers: [
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (key: string) => (key === 'type' ? 'articles' : null) } } } },
                { provide: Router, useValue: { navigate } },
                { provide: MatDialog, useValue: {} },
                { provide: PageCardActions, useValue: { read: vi.fn(async (card: { id: string }) => drafts[card.id] ?? null), publish } },
                { provide: NotifyService, useValue: { error: vi.fn(), success: vi.fn() } },
                { provide: ConfirmService, useValue: { ask: vi.fn(async () => true) } },
                { provide: ContentTypesStore, useValue: { items: signal([articles]), getAll: vi.fn() } },
                { provide: ContentsService, useValue: { pollDeployStatus: () => EMPTY } },
            ],
        });
        TestBed.overrideComponent(PageEditPage, { set: { template: '', imports: [] } });
        return TestBed.createComponent(PageEditPage).componentInstance;
    }
    const drafts: Record<string, Record<string, any>> = {};
    const publish = vi.fn(async () => true);
    afterEach(() => history.replaceState(null, ''));

    it('is the type\'s list page, with its own editors', async () => {
        const page = make();
        expect(page.data.pageId).toBe('list-articles');
        await page.toClassic();
        expect(navigate).toHaveBeenLastCalledWith(['/admin/more-pages/list', 'articles']);
        await page.addEntry();
        expect(navigate).toHaveBeenLastCalledWith(['/admin/edit', 'articles', 'new']);
        expect(page.singularTitle()).toBe('Article');
        await page.close();
        expect(navigate).toHaveBeenLastCalledWith(['/admin/more-pages']);
    });

    it('closes back to the entries it was opened from', async () => {
        history.replaceState({ arcFrom: 'entries' }, '');
        const page = make();
        vi.spyOn(page.data, 'load').mockResolvedValue(undefined);
        page.ngOnInit();
        await page.close();
        expect(navigate).toHaveBeenLastCalledWith(['/admin/contents', 'articles']);
    });

    it('publishes the cards this person changed on the list, with pages checked for an address', async () => {
        const page = make();
        for (const key of Object.keys(drafts)) delete drafts[key];
        drafts['a'] = { id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'list-articles', title: 'A', urlSlug: 'a' };
        drafts['b'] = { id: 'b', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'B', urlSlug: 'b' };
        page.cards.set(['a', 'b'].map((id) => ({ type: 'articles', id, changed: true, leaving: false })));
        publish.mockClear();
        expect(await page.beforePublish()).toBe(true);
        await page.publishWith();
        expect(publish.mock.calls).toEqual([[{ type: 'articles', id: 'a' }, drafts['a'], 'list-articles']]);
        drafts['a']['urlSlug'] = '';
        expect(await page.beforePublish()).toBe(false);
    });

    it('moves a card among the list\'s own cards, the entries not on the page keeping their places', async () => {
        const order = { load: vi.fn(async () => ['x', 'a', 'b', 'c', 'y'].map((id) => ({ id }))), save: vi.fn(async () => undefined) };
        const page = make();
        (page as any).actions.move = (...args: [any, string, boolean]) => PageCardActions.prototype.move.apply({ order } as never, args);
        document.body.innerHTML = `<arc-content-list>${['a', 'b', 'c'].map((id) => `<div data-arc-card-id="${id}" data-arc-card-type="articles"></div>`).join('')}</arc-content-list>`;
        const postMessage = vi.fn();
        (page as any).frame = { nativeElement: { contentWindow: { postMessage }, getBoundingClientRect: () => new DOMRect(0, 0, 800, 600) } };
        page.cardHover(document.querySelector<HTMLElement>('[data-arc-card-id="b"]'));
        // A type with pages: Open and the arrows, no Add and no Remove.
        expect(page.cardBar()).toMatchObject({ hasPages: true, newest: false, move: { before: 'a', after: 'c' } });
        await page.moveCard(page.cardBar()!, true);
        expect(order.save).toHaveBeenCalledWith('articles', ['x', 'a', 'c', 'b', 'y']);
        expect(postMessage).toHaveBeenCalledWith({ arcPageCards: 'reorder', type: 'articles' }, expect.any(String));
        document.body.innerHTML = '';
    });

    it('is drawn when its cards are marked, when it has none, or after a wait (VE-D66)', () => {
        const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');
        expect(listDrawn(doc('<p>Header</p>'))).toBe(false);
        expect(listDrawn(doc('<div data-arc-list-drawn=""><h1>Articles</h1></div>'))).toBe(true);
        const unmarked = doc('<div data-arc-list-drawn=""><article data-arc-field="items" data-arc-row="0">A</article></div>');
        expect(listDrawn(unmarked)).toBe(false);
        expect(listDrawn(unmarked, true)).toBe(true);
        expect(listDrawn(doc('<div data-arc-list-drawn=""><article data-arc-field="items" data-arc-row="0" data-arc-card-id="a">A</article></div>'))).toBe(true);
    });

    /** The frame at its address, with a list drawn in it. */
    const frameOf = (page: PageEditPage, html: string, at = '/admin/preview-page/list/articles?edit=1') => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const url = new URL(at, 'https://site.test');
        const frame = new Proxy(doc, { get: (target, key) => {
            if (key === 'location') return url;
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        } });
        (page as any).frame = { nativeElement: { contentDocument: frame, getBoundingClientRect: () => new DOMRect(0, 0, 800, 600) } };
        const patch = vi.fn();
        (page as any).inPlace = { patch, detach: vi.fn() };
        page.data.lang.set('en');
        page.data.defaultLang.set('en');
        page.drawn.set(true);
        return { doc, frame, patch };
    };

    it('puts the areas\' values back when the cards were drawn again, and keeps the open box by its area', () => {
        const page = make();
        const { doc, frame, patch } = frameOf(page, '<img data-arc-edit="photo">');
        const gone = document.createElement('img');
        page.box.set({ view: { area: { key: 'photo' } } as any, el: gone, top: 0, left: 0 });
        (page as any).redrawn(frame);
        expect(patch).toHaveBeenCalled();
        expect(page.box()!.el).toBe(doc.querySelector('img'));
        page.box.set({ view: { area: { key: 'photo' } } as any, el: gone, top: 0, left: 0 });
        doc.body.innerHTML = '';
        (page as any).redrawn(frame);
        expect(page.box()).toBeNull();
    });

    it('puts nothing back while another language is being drawn (review L2)', () => {
        const page = make();
        const { frame, patch } = frameOf(page, '<h1 data-arc-edit="title"></h1>');
        page.drawn.set(false);
        expect((page as any).redrawn(frame)).toBe(false);
        page.drawn.set(true);
        page.data.lang.set('hi');
        expect((page as any).redrawn(frame)).toBe(false);
        expect(patch).not.toHaveBeenCalled();
    });

    it('keeps words whose save failed on the page, and the stored ones once it landed (review L2)', async () => {
        const page = make();
        const { frame, patch } = frameOf(page, '');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const view = { area: { key: 'title' }, words: 'Stored', fileWords: 'Articles', defaultWords: '' } as any;
        (page as any).views = () => [view];
        const session = { draft: signal(null), close: vi.fn(), saveText: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined) };
        (page.data as any).sessionRef.set(session);
        page.saveWords(view, 'Typed');
        await vi.waitFor(() => expect(page.saveError()).toBe('offline'));
        (page as any).redrawn(frame);
        expect(patch.mock.calls.at(-1)![0][0].words).toBe('Typed');
        page.saveWords(view, 'Typed');
        await vi.waitFor(() => expect(page.saveError()).toBe(''));
        (page as any).redrawn(frame);
        expect(patch.mock.calls.at(-1)![0][0].words).toBe('Stored');
    });

    it('is drawn again only when the list\'s own nodes were replaced, not when an area or a card was written (review M1)', () => {
        const doc = new DOMParser().parseFromString('<arc-content-list><div data-arc-list-drawn=""><h1 data-arc-edit="title">T</h1></div></arc-content-list>', 'text/html');
        const record = (target: Element, added: Element[] = [], type = 'childList') => ({ type, target, addedNodes: added }) as unknown as MutationRecord;
        const list = doc.querySelector('[data-arc-list-drawn]')!;
        expect(listReplaced(record(list))).toBe(true);
        expect(listReplaced(record(doc.querySelector('arc-content-list')!, [list]))).toBe(true);
        expect(listReplaced(record(doc.querySelector('h1')!))).toBe(false);
        expect(listReplaced(record(list, [], 'attributes'))).toBe(false);
    });

    it('one Publish puts the words and the cards changed on the list out together (VE-D63)', async () => {
        const page = make();
        for (const key of Object.keys(drafts)) delete drafts[key];
        drafts['a'] = { id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'list-articles', title: 'A', urlSlug: 'a' };
        page.cards.set([{ type: 'articles', id: 'a', changed: true, leaving: false }]);
        const went: string[] = [];
        const session = { draft: signal({ text: { en: { title: { value: 'Our stories' } } } }), close: vi.fn(), error: signal(null), publish: vi.fn(async () => { went.push('words'); }) };
        (page.data as any).sessionRef.set(session);
        (page as any).panelRef = () => ({ status: () => 'changes' });
        publish.mockClear();
        publish.mockImplementation(async () => { went.push('card a'); return true; });
        expect(await page.beforePublish()).toBe(true);
        await page.publishWith();
        expect(went).toEqual(['words', 'card a']);
        // A card that fails stops the words too.
        went.length = 0;
        drafts['a'] = { ...drafts['a'], urlSlug: '' };
        expect(await page.beforePublish()).toBe(false);
        expect(went).toEqual([]);
        // Someone else's words stay theirs; this person's card still goes.
        drafts['a'] = { ...drafts['a'], urlSlug: 'a' };
        (page.data as any).heldBy = () => ({ by: 'priya', name: 'Priya' });
        expect(await page.beforePublish()).toBe(true);
        await page.publishWith();
        expect(went).toEqual(['card a']);
    });

    it('goes back where it was first opened from, also through the classic editor (review L6)', async () => {
        history.replaceState({ arcOpenedFrom: '/hi/articles', navigationId: 7 }, '');
        const page = make();
        vi.spyOn(page.data, 'load').mockResolvedValue(undefined);
        page.ngOnInit();
        await page.toClassic();
        expect(navigate).toHaveBeenLastCalledWith(['/admin/more-pages/list', 'articles'], { state: { arcOpenedFrom: '/hi/articles' } });
    });

    it('never goes to an address of another site', async () => {
        history.replaceState({ arcOpenedFrom: '//other.test/', arcFrom: 'entries', navigationId: 7 }, '');
        const page = make();
        vi.spyOn(page.data, 'load').mockResolvedValue(undefined);
        page.ngOnInit();
        await page.toClassic();
        expect(navigate).toHaveBeenLastCalledWith(['/admin/more-pages/list', 'articles'], { state: { arcFrom: 'entries' } });
    });
});
