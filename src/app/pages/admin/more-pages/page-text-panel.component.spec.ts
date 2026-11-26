/**
 * The page's panel on the Visual Editor (page-text-panel.component.ts,
 * specs/visual-editing-spec.md VE-D51, VE-D53): its Publish also takes the changed
 * cards, so it is on when only cards changed, and it runs the screen's checks
 * and the screen's one Publish.
 */
import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';
import { PageTextService } from '../../../core/site/page-text.service';
import { PageTextPanelComponent } from './page-text-panel.component';
import { areaView, type ListBasics, type SeoView } from './page-text-editor.model';
import { readPageFile } from '../../../core/utils/page-text-areas';
import { listPageWords } from '../../../core/utils/page-text-model';

describe('PageTextPanelComponent with cards (VE-D53)', () => {
    let push: (value: unknown) => void = () => undefined;
    const stop = vi.fn();
    async function make(extra: number) {
        const session = { pageId: 'home', draft: signal<any>(null), publish: vi.fn() };
        await TestBed.configureTestingModule({
            imports: [PageTextPanelComponent, translocoTestingModule()],
            providers: [
                { provide: MatDialog, useValue: {} },
                { provide: PageTextService, useValue: {
                    published: vi.fn().mockResolvedValue(null), history: vi.fn().mockResolvedValue([]),
                    followPublished: (_id: string, next: (value: unknown) => void) => { push = next; next(null); return stop; },
                } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(PageTextPanelComponent);
        const publishWith = vi.fn().mockResolvedValue(undefined);
        const beforePublish = vi.fn().mockResolvedValue(true);
        fixture.componentRef.setInput('session', session);
        fixture.componentRef.setInput('lang', 'en');
        fixture.componentRef.setInput('defaultLang', 'en');
        fixture.componentRef.setInput('extraChanges', extra);
        fixture.componentRef.setInput('publishWith', publishWith);
        fixture.componentRef.setInput('beforePublish', beforePublish);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return { fixture, session, publishWith, beforePublish };
    }

    it('is off with nothing to publish', async () => {
        const { fixture } = await make(0);
        expect(fixture.componentInstance.canPublish()).toBe(false);
        expect(fixture.componentInstance.state()).toBe('published');
    });

    it('is on when only cards changed, and runs the checks, then the one Publish', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        try {
            const { fixture, session, publishWith, beforePublish } = await make(2);
            expect(fixture.componentInstance.canPublish()).toBe(true);
            expect(fixture.componentInstance.state()).toBe('changes');
            await fixture.componentInstance.publish();
            expect(beforePublish).toHaveBeenCalled();
            expect(publishWith).toHaveBeenCalled();
            expect(session.publish).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('offers Review when only a card changed, and shows no date for a page never published', async () => {
        const { fixture } = await make(1);
        push(null);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('[data-testid="review-changes"]')).not.toBeNull();
        expect(el.querySelector('[data-testid="last-published"]')).toBeNull();
        fixture.componentRef.setInput('extraChanges', 0);
        fixture.detectChanges();
        expect(el.querySelector('[data-testid="review-changes"]')).toBeNull();
        expect(fixture.componentInstance.state()).toBe('published');
        // A card it sent is not on the site yet.
        fixture.componentRef.setInput('cardsGoing', true);
        expect(fixture.componentInstance.state()).toBe('publishing');
    });

    it('follows the published copy: another editor\'s publish, and a page that did not go live', async () => {
        const { fixture, session } = await make(0);
        const panel = fixture.componentInstance;
        session.draft.set({ updatedAt: { toMillis: () => 5 }, text: { en: { hero: { value: 'A' } } } });
        expect(panel.status()).toBe('changes');
        push({ draftUpdatedAt: { toMillis: () => 5 }, publishedAt: { toMillis: () => 6 }, text: { en: { hero: { value: 'A' } } } });
        expect(panel.status()).toBe('published');

        session.draft.set({ updatedAt: { toMillis: () => 7 }, text: { en: { hero: { value: 'B' } } } });
        panel.awaitPublish();
        expect(panel.publishing()).toBe(true);
        push({ draftUpdatedAt: null, publishedAt: { toMillis: () => 8 } });
        expect(panel.publishing()).toBe(false);
        expect(panel.publishError()).toContain('did not go live');
        fixture.destroy();
        expect(stop).toHaveBeenCalled();
    });

    it('reads an open History again whenever a new published copy comes, whoever published (VE-D71)', async () => {
        const { fixture } = await make(0);
        const history = TestBed.inject(PageTextService).history as ReturnType<typeof vi.fn>;
        push({ draftUpdatedAt: null, publishedAt: { toMillis: () => 5 } });
        expect(history).not.toHaveBeenCalled();
        fixture.componentInstance.showTab('history');
        expect(history).toHaveBeenCalledTimes(1);
        push({ draftUpdatedAt: null, publishedAt: { toMillis: () => 9 } });
        expect(history).toHaveBeenCalledTimes(2);
        // The same copy drawn again (its stamp cleared, say) is not a new version.
        push({ draftUpdatedAt: { toMillis: () => 1 }, publishedAt: { toMillis: () => 9 } });
        expect(history).toHaveBeenCalledTimes(2);
    });

    it('says Publishing until the page itself is out, not when its words are copied (live check 2026-11-24)', async () => {
        const { fixture, session } = await make(0);
        const panel = fixture.componentInstance;
        const words = { text: { en: { hero: { value: 'A' } } } };
        session.draft.set({ updatedAt: { toMillis: () => 5 }, ...words });
        panel.awaitPublish();
        const copied = { draftUpdatedAt: { toMillis: () => 5 }, publishedAt: { toMillis: () => Date.now() }, ...words };
        push({ ...copied, liveAt: null });
        expect(panel.publishing()).toBe(true);
        expect(panel.state()).toBe('publishing');
        push({ ...copied, liveAt: { toMillis: () => Date.now() } });
        expect(panel.publishing()).toBe(false);
        expect(panel.state()).toBe('published');
        // A screen opened meanwhile says so too.
        push({ ...copied, liveAt: null });
        expect(panel.state()).toBe('publishing');
        expect(panel.entryCount({ id: 'v', seo: { en: { title: { value: 'T' } } }, shareImage: { value: '/s' } } as any)).toBe(2);
        fixture.destroy();
    });

    it('says nothing and publishes nothing before the draft and the published copy are read (review M8)', async () => {
        const { fixture, session } = await make(1);
        const panel = fixture.componentInstance;
        expect(panel.known()).toBe(true);
        (session as any).loaded = signal(false);
        fixture.componentRef.setInput('session', { ...session });
        fixture.detectChanges();
        expect(panel.known()).toBe(false);
        expect(panel.canPublish()).toBe(false);
        expect(fixture.nativeElement.querySelector('arc-page-status')).toBeNull();
    });

    it('publishes only Publish these while someone else holds the words, and never the words otherwise', async () => {
        const { fixture, session } = await make(0);
        const panel = fixture.componentInstance;
        await panel.publishWords();
        expect(session.publish).not.toHaveBeenCalled();
        fixture.componentRef.setInput('locked', true);
        fixture.componentRef.setInput('publishWith', null);
        await panel.publish();
        expect(session.publish).not.toHaveBeenCalled();
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        try {
            await panel.publishWords();
        } finally {
            vi.useRealTimers();
        }
        expect(session.publish).toHaveBeenCalledTimes(1);
    });

    it('keeps Publish off while cards are on their way, until the wait gives up and says so (VE-D88)', async () => {
        const { fixture } = await make(0);
        const panel = fixture.componentInstance;
        fixture.componentRef.setInput('extraChanges', 1);
        expect(panel.canPublish()).toBe(true);
        fixture.componentRef.setInput('cardsGoing', true);
        expect(panel.state()).toBe('publishing');
        expect(panel.canPublish()).toBe(false);
        panel.publishError.set('Publishing is taking longer than usual.');
        expect(panel.canPublish()).toBe(true);
    });

    it('says Not saved when a save elsewhere on the screen failed, and Saving while one runs', async () => {
        const { fixture } = await make(0);
        fixture.componentRef.setInput('failed', true);
        expect(fixture.componentInstance.state()).toBe('not_saved');
        fixture.componentRef.setInput('busy', true);
        expect(fixture.componentInstance.state()).toBe('saving');
        expect(fixture.componentInstance.canPublish()).toBe(false);
    });
});

describe('PageTextPanelComponent on a list page (VE-D60, VE-D69)', () => {
    const FILE = readPageFile('<h1 data-arc-edit="title">Articles</h1><p data-arc-edit="intro" data-arc-edit-kind="rich">All <b>news</b></p>');
    const SEO: SeoView = { title: '', titleFallback: 'Articles', description: '', descriptionFallback: 'All news', shareImage: '' };
    const basicsOf = (draft: any, over: Partial<ListBasics> = {}): ListBasics => {
        const ctx = { lang: 'en', defaultLang: 'en', ownFile: true, file: FILE, defaultFile: FILE, strings: {}, draft };
        return { title: areaView(FILE.areas[0], ctx), intro: areaView(FILE.areas[1], ctx), titleMarked: true, introMarked: true, ...over };
    };

    async function make(basics: ListBasics | null, seo: SeoView = SEO) {
        const session = {
            pageId: 'list-articles', draft: signal<any>(null), publish: vi.fn(),
            saveText: vi.fn().mockResolvedValue(undefined), useFileText: vi.fn().mockResolvedValue(undefined),
            saveSeo: vi.fn().mockResolvedValue(undefined), useFileSeo: vi.fn().mockResolvedValue(undefined),
        };
        await TestBed.configureTestingModule({
            imports: [PageTextPanelComponent, translocoTestingModule()],
            providers: [
                { provide: MatDialog, useValue: {} },
                { provide: PageTextService, useValue: {
                    history: vi.fn().mockResolvedValue([]), followPublished: (_id: string, next: (value: unknown) => void) => { next(null); return () => undefined; },
                } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(PageTextPanelComponent);
        for (const [name, value] of Object.entries({ session, lang: 'en', defaultLang: 'en', seo, basics, url: 'https://site.test/articles' })) fixture.componentRef.setInput(name, value);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        const field = <T extends HTMLElement = HTMLInputElement>(id: string) => el.querySelector<T>(`#${id}`)!;
        const typeIn = async (id: string, value: string) => {
            const input = field<HTMLInputElement>(id);
            input.value = value;
            input.dispatchEvent(new Event('input'));
            input.dispatchEvent(new Event('blur'));
            await fixture.whenStable();
        };
        return { fixture, el, session, field, typeIn };
    }

    it('its Title and Summary are its heading and intro, with the file\'s words as placeholders, and nothing is stored twice', async () => {
        const { el, session, field, typeIn } = await make(basicsOf(null));
        expect(field('page-title').placeholder).toBe('Articles');
        expect(field<HTMLTextAreaElement>('page-summary').placeholder).toBe('All news');
        expect(el.textContent).toContain('The heading of the page.');
        expect(el.textContent).toContain('Set under Content types.');
        // Spaces tidied as words typed on the page are, so a click there finds nothing to save.
        await typeIn('page-title', '  Our   stories ');
        expect(session.saveText).toHaveBeenCalledWith('en', 'title', 'Our stories', { fileText: 'Articles' });
        // Plain words in an area of formatted text stay plain words.
        // "Tom & Jerry's <3" is followed to the published head in deployContentListPage.spec.ts.
        await typeIn('page-summary', 'Tom & Jerry\'s <3');
        expect(session.saveText).toHaveBeenCalledWith('en', 'intro', 'Tom &amp; Jerry\'s &lt;3', { fileText: 'All <b>news</b>' });
        const options = { lang: 'en', defaultLang: 'en', named: { title: false, intro: false }, rich: { title: false, intro: true } };
        expect(listPageWords({ text: { en: { intro: { value: session.saveText.mock.calls.at(-1)![2] } } } }, options).seoDescription).toBe('Tom & Jerry\'s <3');
        expect(session.saveSeo).not.toHaveBeenCalled();
    });

    it('shows the area\'s own value, and emptying it goes back to the file\'s', async () => {
        const { el, session, field, typeIn } = await make(basicsOf({ text: { en: { title: { value: 'Our stories' }, intro: { value: 'Told &amp; <b>by</b> us' } } } }));
        expect(field('page-title').value).toBe('Our stories');
        expect(field('page-title').readOnly).toBe(false);
        // Formatted words are changed on the page: a plain field would drop the formatting.
        expect(field<HTMLTextAreaElement>('page-summary').value).toBe('Told & by us');
        expect(field<HTMLTextAreaElement>('page-summary').readOnly).toBe(true);
        expect(el.querySelector('[data-testid="formatted-summary"]')?.textContent).toContain('It has formatting: change it on the page.');
        expect(el.querySelector('[data-testid="formatted-title"]')).toBeNull();
        await typeIn('page-title', ' ');
        expect(session.useFileText).toHaveBeenCalledWith('en', 'title');
    });

    it('says the developer sets what the page shows when nothing is marked, and that the SEO words win', async () => {
        const { el } = await make(basicsOf(null, { titleMarked: false, introMarked: false }), { ...SEO, title: 'Search title', description: 'Search words' });
        expect(el.textContent).toContain('The heading on the page is set by your developer.');
        expect(el.textContent).toContain('The words on the page are set by your developer.');
        expect(el.textContent).toContain('Search engines and shares show the SEO title instead');
        expect(el.textContent).toContain('Search engines and shares show the meta description instead');
    });

    it('the SEO tab has an SEO title and meta description over them, empty until wanted, and what goes out', async () => {
        const { fixture, el, session, field, typeIn } = await make(basicsOf(null));
        fixture.componentInstance.showTab('seo');
        fixture.detectChanges();
        expect(field('seo-title').value).toBe('');
        expect(field('seo-title').placeholder).toBe('Articles');
        expect(el.querySelector('arc-share-preview')?.textContent).toContain('All news');
        await typeIn('seo-title', 'Stories, searched');
        await typeIn('seo-summary', 'Words for search');
        expect(session.saveSeo.mock.calls).toEqual([['en', 'title', 'Stories, searched'], ['en', 'description', 'Words for search']]);
        expect(session.saveText).not.toHaveBeenCalled();
    });

    it('on any other page the SEO tab is the preview alone, and Basic edits the SEO words (VE-D68)', async () => {
        const { fixture, session, field, typeIn } = await make(null);
        await typeIn('page-title', 'About us');
        expect(session.saveSeo).toHaveBeenCalledWith('en', 'title', 'About us');
        fixture.componentInstance.showTab('seo');
        fixture.detectChanges();
        expect(field('seo-title')).toBeNull();
    });
});
