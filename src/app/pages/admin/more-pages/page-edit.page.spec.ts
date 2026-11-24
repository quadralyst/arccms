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
import PageEditPage, { pageCardsIn, pageEditFrameUrl, pageLivePreviewUrl, pageValuesHaveReplace, siteAddressOpenedFrom } from './page-edit.page';
import { PageCardActions } from './page-card-actions';
import { NotifyService } from '../../../../shared/services/notify.service';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { ContentTypesStore } from '../contents/content-types/content-types.store';

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
        expect(pageEditFrameUrl('', 'en', 'en')).toBe('/admin/preview-page/home?edit=1');
        expect(pageLivePreviewUrl('', 'en', 'en')).toBe('/admin/preview-page/home?cards=1');
        expect(pageLivePreviewUrl('', 'hi', 'en')).toBe('/admin/preview-page/home/hi?cards=1');
        // A static page is in the default language only.
        expect(pageLivePreviewUrl('about us', 'hi', 'en')).toBe('/admin/preview-page/p/about%20us?cards=1');
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

    beforeEach(() => {
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
        expect(notify.success).toHaveBeenCalledWith('admin.edit_page.cards_published', { count: 1 });
    });

    it('names a card someone saved or unpublished after the check, and publishes the rest', async () => {
        drafts['a'] = { id: 'a', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'Changed since', customFields: { person: 'Asha' } };
        drafts['b'] = { id: 'b', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'Second', customFields: { person: 'Ravi' } };
        changed('a', 'b');
        actions.publish.mockImplementation(async (card: { id: string }) => card.id !== 'a');
        expect(await page.beforePublish()).toBe(true);
        await expect(page.publishWith()).rejects.toThrow(/Changed since/);
        expect(notify.success).toHaveBeenCalledWith('admin.edit_page.cards_published', { count: 1 });
    });
});
