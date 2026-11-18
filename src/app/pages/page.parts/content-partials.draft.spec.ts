/**
 * A card block on the live preview (specs/visual-editing-spec.md, VE2.2): the
 * draft is drawn among the published cards, in its place, and its card is marked.
 * Without a CardDraft (every page of the site) nothing changes: the other specs.
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
import { CardDraft, CardDraftEntry } from './card-draft';
import { setSiteManifestForTesting } from '../../core/site/site';
import { coreSiteManifest } from '../../../test/core-site';

const PARTIALS = '<section><div data-arc-loop="items"><article class="card">{{ title }}</article></div></section>';

describe('ContentPartialsComponent with a draft (VE2.2)', () => {
    let fixture: ComponentFixture<ContentPartialsComponent>;
    let entry: ReturnType<typeof signal<CardDraftEntry | null>>;
    const published = (id: string, day: number) => ({ id, type: 'quotes', title: `Quote ${id}`, publishedStatus: true, publishedOn: `2026-01-0${day}T00:00:00Z` });
    const settle = async () => {
        for (let i = 0; i < 4; i++) {
            fixture.detectChanges();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    };
    const cards = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('article.card')).map((c) => c.textContent);

    beforeEach(async () => {
        setSiteManifestForTesting(coreSiteManifest());
        entry = signal<CardDraftEntry | null>(null);
        const contents = { items: signal([published('a', 3), published('b', 2), published('c', 1)]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() };
        const types = { items: signal([{ slug: 'quotes', name: 'Quotes', hasPublicUrl: false }]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() };
        await TestBed.configureTestingModule({
            imports: [ContentPartialsComponent],
            providers: [
                { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of(PARTIALS)) } },
                { provide: CardDraft, useValue: { entry } },
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

    it('draws the published cards until a draft arrives', () => {
        expect(cards()).toEqual(['Quote a', 'Quote b']);
        expect(fixture.nativeElement.querySelector('[data-arc-draft]')).toBeNull();
    });

    it('swaps the draft in for its published copy, marks its card, and follows each change', async () => {
        entry.set({ type: 'quotes', content: { ...published('b', 2), title: 'Edited b' } });
        await settle();
        expect(cards()).toEqual(['Quote a', 'Edited b']);
        expect(fixture.nativeElement.querySelector('[data-arc-draft]')?.textContent).toBe('Edited b');
        entry.set({ type: 'quotes', content: { ...published('b', 2), title: 'Edited again' } });
        await settle();
        expect(cards()).toEqual(['Quote a', 'Edited again']);
    });

    it('a draft the count leaves out takes the last card\'s place, and says so', async () => {
        entry.set({ type: 'quotes', content: { ...published('c', 1), title: 'Old one' } });
        await settle();
        expect(cards()).toEqual(['Quote a', 'Old one']);
        expect(fixture.nativeElement.querySelector('[data-arc-draft]')?.getAttribute('data-arc-draft')).toBe('last');
    });

    it('a draft of another type changes nothing', async () => {
        entry.set({ type: 'news', content: { id: 'n', title: 'News', publishedOn: '2026-02-01' } });
        await settle();
        expect(cards()).toEqual(['Quote a', 'Quote b']);
    });
});
