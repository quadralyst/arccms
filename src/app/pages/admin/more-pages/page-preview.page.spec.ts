/** Live Preview of a page (page-preview.page.ts, specs/visual-editing-spec.md VE-D50). */
import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Component, signal } from '@angular/core';
import { PageTextService } from '../../../core/site/page-text.service';
import { PAGE_TEXT_PREVIEW } from '../../../core/site/page-text-preview';
import PagePreviewPage from './page-preview.page';
import { PageCardDrafts } from '../../page.parts/card-draft';
import { PageCardsSource } from './page-cards';
import HomeComponent from '../../index.page';
import { PublicPageRendererComponent } from '../../public-page-renderer/public-page-renderer.component';

let drawn = 0;
@Component({ selector: 'arc-home', standalone: true, template: '' })
class FakeHome {
    preview = (TestBed.inject(PAGE_TEXT_PREVIEW, null, { optional: true }));
    constructor() { drawn++; }
}

describe('PagePreviewPage', () => {
    it('draws the page with the draft, and again after each save', async () => {
        const draft = signal<any>(null);
        const loaded = signal(false);
        const session = { draft, loaded, open: vi.fn(), close: vi.fn() };
        const sessionFor = vi.fn(() => session);
        TestBed.configureTestingModule({
            imports: [PagePreviewPage],
            providers: [
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
                { provide: PageTextService, useValue: { session: sessionFor } },
            ],
        });
        TestBed.overrideComponent(PagePreviewPage, { remove: { imports: [HomeComponent, PublicPageRendererComponent] }, add: { imports: [FakeHome] } });
        const fixture = TestBed.createComponent(PagePreviewPage);
        fixture.detectChanges();
        expect(sessionFor).toHaveBeenCalledWith('home');
        expect(session.open).toHaveBeenCalled();
        expect(drawn).toBe(0);

        draft.set({ text: { en: { hero: { value: 'Hi' } } } });
        loaded.set(true);
        fixture.detectChanges();
        expect(drawn).toBe(1);
        expect(fixture.componentInstance.values()).toEqual({ text: { en: { hero: { value: 'Hi' } } } });

        draft.set({ text: { en: { hero: { value: 'Hi all' } } } });
        fixture.detectChanges();
        expect(drawn).toBe(2);

        fixture.destroy();
        expect(session.close).toHaveBeenCalled();
    });

    it('follows the changed cards for Live Preview from the Visual Editor, drawn as on the site', () => {
        const session = { draft: signal<any>(null), loaded: signal(true), open: vi.fn(), close: vi.fn() };
        const query = (params: Record<string, string>) => ({ get: (key: string) => params[key] ?? null });
        const make = (params: Record<string, string>) => {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                imports: [PagePreviewPage],
                providers: [
                    { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null }, queryParamMap: query(params) } } },
                    { provide: PageTextService, useValue: { session: () => session } },
                ],
            });
            TestBed.overrideComponent(PagePreviewPage, { remove: { imports: [HomeComponent, PublicPageRendererComponent] }, add: { imports: [FakeHome] } });
            TestBed.overrideProvider(PageCardsSource, { useValue: Object.assign(Object.create(PageCardDrafts.prototype), { editing: true, start: vi.fn(), watch: vi.fn(), cardsOf: () => null }) });
            const fixture = TestBed.createComponent(PagePreviewPage);
            const drafts = fixture.debugElement.injector.get(PageCardDrafts, null);
            const source = fixture.debugElement.injector.get(PageCardsSource) as unknown as { start: ReturnType<typeof vi.fn> };
            fixture.destroy();
            return { drafts, source };
        };
        // Live Preview from the Visual Editor: the cards' drafts, as Publish would put them out.
        const live = make({ cards: '1' });
        expect(live.drafts).not.toBeNull();
        expect(live.drafts!.editing).toBe(false);
        expect(live.source.start).toHaveBeenCalledWith('home');
        // The Visual Editor's frame: the cards' drafts, for editing.
        expect(make({ edit: '1' }).drafts!.editing).toBe(true);
        // The classic editor's Live Preview: the published cards.
        expect(make({}).drafts).toBeNull();
    });
});
