/**
 * A card block on a page's Visual Editor (specs/visual-editing-spec.md, VE-D53,
 * VE-D54): every card with unpublished changes is drawn from its draft, each card
 * is marked with its entry and its values, and a card Publish would push out
 * comes last, marked. Without PageCardDrafts nothing changes: the other specs.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReadableStream } from 'stream/web';
(global as any).ReadableStream = ReadableStream;
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ContentPartialsComponent } from './content-partials.component';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { PageCardDrafts, type PageCardsOfType } from './card-draft';
import { setSiteManifestForTesting } from '../../core/site/site';
import { coreSiteManifest } from '../../../test/core-site';

const PARTIALS = '<section><div data-arc-loop="items"><article class="card">{{ title }}</article></div></section>';

describe('ContentPartialsComponent on a page\'s Visual Editor (VE-D53, VE-D54)', () => {
    let fixture: ComponentFixture<ContentPartialsComponent>;
    let page: ReturnType<typeof signal<PageCardsOfType<Record<string, any>> | null>>;
    const watch = vi.fn();
    /** The frame (editing) or Live Preview from the Visual Editor (not editing). */
    const drafts = { editing: true, watch, cardsOf: (type: string) => (type === 'quotes' ? page() : null) };
    const published = (id: string, day: number) => ({ id, type: 'quotes', title: `Quote ${id}`, publishedStatus: true, publishedOn: `2026-01-0${day}T00:00:00Z` });
    const settle = async () => {
        for (let i = 0; i < 4; i++) {
            fixture.detectChanges();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    };
    const root = () => fixture.nativeElement as HTMLElement;
    const cards = () => Array.from(root().querySelectorAll('article.card')).map((c) => c.textContent);

    beforeEach(async () => {
        setSiteManifestForTesting(coreSiteManifest());
        page = signal<PageCardsOfType<Record<string, any>> | null>(null);
        drafts.editing = true;
        const contents = { items: signal([published('a', 3), published('b', 2), published('c', 1)]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() };
        const types = { items: signal([{ slug: 'quotes', name: 'Quotes', hasPublicUrl: false }]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() };
        await TestBed.configureTestingModule({
            imports: [ContentPartialsComponent],
            providers: [
                { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of(PARTIALS)) } },
                { provide: PageCardDrafts, useValue: drafts },
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } }, paramMap: of({ get: () => null, keys: [] }), queryParams: of({}) } },
            ],
        })
            .overrideComponent(ContentPartialsComponent, {
                set: { providers: [{ provide: ContentsStore, useValue: contents }, { provide: ContentTypesStore, useValue: types }] },
            })
            .compileComponents();
        fixture = TestBed.createComponent(ContentPartialsComponent);
        fixture.componentRef.setInput('contentType', 'quotes');
        fixture.componentRef.setInput('count', 2);
        await settle();
    });

    afterEach(() => setSiteManifestForTesting());

    it('follows its type\'s drafts, and draws the published cards until they are read', () => {
        expect(watch).toHaveBeenCalledWith('quotes');
        expect(cards()).toEqual(['Quote a', 'Quote b']);
    });

    it('marks each card with its entry and its values, and the changed ones', async () => {
        page.set({ changed: [{ ...published('b', 2), title: 'Edited b' }], hidden: new Set(), sortOrder: {}, focus: null });
        await settle();
        expect(cards()).toEqual(['Quote a', 'Edited b']);
        const b = root().querySelector('[data-arc-card-id="b"]')!;
        expect(b.getAttribute('data-arc-card-type')).toBe('quotes');
        expect(b.hasAttribute('data-arc-changed')).toBe(true);
        expect(root().querySelector('[data-arc-card-id="a"]')!.hasAttribute('data-arc-changed')).toBe(false);
        // The card's own values are marked, to be typed in place.
        expect(root().querySelector('[data-arc-card-id="a"] [data-arc-sub="title"], [data-arc-card-id="a"][data-arc-sub="title"]')).not.toBeNull();
    });

    it('draws a card a full block pushes out last and faint, marked as leaving', async () => {
        page.set({ changed: [{ ...published('n', 9), title: 'New one' }], hidden: new Set(), sortOrder: {}, focus: null });
        await settle();
        expect(cards()).toEqual(['New one', 'Quote a', 'Quote b']);
        expect(root().querySelector('[data-arc-leaving]')?.getAttribute('data-arc-card-id')).toBe('b');
    });

    it('in Live Preview draws the block as Publish leaves it: no card pushed out, nothing marked', async () => {
        drafts.editing = false;
        page.set({ changed: [{ ...published('n', 9), title: 'New one' }], hidden: new Set(), sortOrder: {}, focus: null });
        await settle();
        expect(cards()).toEqual(['New one', 'Quote a']);
        expect(root().querySelector('[data-arc-leaving], [data-arc-changed], [data-arc-sub]')).toBeNull();
    });

    it('never draws a card taken off the page', async () => {
        page.set({ changed: [], hidden: new Set(['a']), sortOrder: {}, focus: null });
        await settle();
        expect(cards()).toEqual(['Quote b', 'Quote c']);
    });

    it('a block in the footer is not edited: published cards, no marks (VE-D20)', async () => {
        watch.mockClear();
        page.set({ changed: [{ ...published('b', 2), title: 'Edited b' }], hidden: new Set(), sortOrder: {}, focus: null });
        const footer = document.createElement('arc-footer');
        document.body.appendChild(footer);
        const inFooter = TestBed.createComponent(ContentPartialsComponent);
        footer.appendChild(inFooter.nativeElement);
        inFooter.componentRef.setInput('contentType', 'quotes');
        inFooter.componentRef.setInput('count', 2);
        for (let i = 0; i < 4; i++) {
            inFooter.detectChanges();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const el = inFooter.nativeElement as HTMLElement;
        expect(Array.from(el.querySelectorAll('article.card')).map((c) => c.textContent)).toEqual(['Quote a', 'Quote b']);
        expect(el.querySelector('[data-arc-card-id]')).toBeNull();
        expect(watch).not.toHaveBeenCalled();
        footer.remove();
    });
});
