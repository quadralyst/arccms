/**
 * The live preview window (specs/visual-editing-spec.md, VE1.4 and VE2.2 to VE2.4).
 * The site's components are stubbed: their own specs cover what they draw; this
 * covers which one the window shows, the strip, the channel and the clicks.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Component, input, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ContentPreviewComponent } from './content-preview.component';
import { PreviewSession } from './preview-session';
import { ContentTypesStore } from '../contents/content-types/content-types.store';
import { DraftContentsService } from '../contents/draft-content-store/draft-contents.service';
import { LocalizationService } from '../../../core/services/localization.service';
import { UiStringsService } from '../../../core/services/ui-strings.service';
import { PreviewChannel } from '../../../core/preview/preview-channel';
import { DetailSource } from '../../page.parts/detail-source';
import { CardDraft } from '../../page.parts/card-draft';

@Component({ selector: 'arc-content-detail', standalone: true, template: '<article><h1 data-arc-field="title">T</h1><p data-arc-field="price">20</p><ul><li data-arc-field="faq" data-arc-row="1"><b>Q</b></li></ul><span data-arc-field="publishedOn">D</span><a id="out" href="/elsewhere">x</a><a id="anchor" href="#top">y</a><form><button id="join">Join</button></form></article>' })
class DetailStub {}
@Component({ selector: 'arc-home', standalone: true, template: '<section><div data-arc-field="items" data-arc-row="0" data-arc-draft="last">Card</div></section>' })
class HomeStub {}
@Component({ selector: 'arc-header', standalone: true, template: '<header>H</header>' })
class HeaderStub {}
@Component({ selector: 'arc-footer', standalone: true, template: '<footer>F</footer>' })
class FooterStub {}
@Component({ selector: 'arc-content-partials', standalone: true, template: '<div class="cards">{{ contentType() }}</div>' })
class PartialsStub { contentType = input(''); }

describe('ContentPreviewComponent', () => {
    let fixture: ComponentFixture<ContentPreviewComponent>;
    let component: ContentPreviewComponent;
    let post: ReturnType<typeof vi.spyOn>;
    let types: any;
    let http: any;
    let drafts: any;
    let id = 'e1';

    const HOME_WITH = '<arc-content-partials content-type="quotes"></arc-content-partials>';

    async function create(type: Record<string, unknown>, homeHtml = '', query: Record<string, string> = {}) {
        types = { items: signal([type]), getAll: vi.fn(), isLoading: signal(false) };
        http = { get: vi.fn().mockReturnValue(of(homeHtml)) };
        drafts = { getDraftById: vi.fn().mockResolvedValue({ id, title: 'Saved', type: type['slug'] }) };
        await TestBed.configureTestingModule({
            imports: [ContentPreviewComponent],
            providers: [
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (k: string) => (k === 'type' ? type['slug'] : id) }, fragment: 's=key-1', queryParamMap: { get: (k: string) => query[k] ?? null } } } },
                { provide: ContentTypesStore, useValue: types },
                { provide: HttpClient, useValue: http },
                { provide: DraftContentsService, useValue: drafts },
                { provide: LocalizationService, useValue: { load: vi.fn().mockResolvedValue({}), isMultilingual: () => true, find: (code: string) => ({ code, label: code === 'hi' ? 'Hindi' : code }) } },
                { provide: UiStringsService, useValue: { use: vi.fn().mockResolvedValue({}) } },
            ],
        })
            .overrideComponent(ContentPreviewComponent, { set: { imports: [DetailStub, HomeStub, HeaderStub, FooterStub, PartialsStub, (await import('@jsverse/transloco')).TranslocoPipe] } })
            .compileComponents();
        fixture = TestBed.createComponent(ContentPreviewComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await settle();
    }
    const settle = async () => {
        for (let i = 0; i < 3; i++) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            fixture.detectChanges();
        }
    };
    const text = (selector: string) => (fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent?.trim() ?? '';
    const state = (lang = '', draft: Record<string, any> = { id, title: 'Live' }) =>
        component.onMessage({ kind: 'state', draft, lang, translation: null });
    const sent = (kind: string) => post.mock.calls.map((c: any[]) => c[0]).filter((m: any) => m.kind === kind);
    const click = (selector: string) => {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        (fixture.nativeElement as HTMLElement).querySelector(selector)!.dispatchEvent(event);
        return event;
    };

    beforeEach(() => {
        id = 'e1';
        post = vi.spyOn(PreviewChannel.prototype, 'post');
    });
    afterEach(() => {
        post.mockRestore();
        TestBed.resetTestingModule();
    });

    it('is the page\'s DetailSource and CardDraft, and asks the editor for the draft on its own key', async () => {
        await create({ slug: 'events', fields: [] });
        const injector = fixture.debugElement.injector;
        expect(injector.get(DetailSource)).toBe(injector.get(PreviewSession));
        expect(injector.get(CardDraft)).toBe(injector.get(PreviewSession));
        expect(sent('hello')).toHaveLength(1);
        expect((component as any).channel).toBeTruthy();
        expect(text('[data-testid="preview-status"]')).toBe('Waiting for the editor');
    });

    it('a type with pages shows its own page once the draft arrives, and says it is connected', async () => {
        await create({ slug: 'events', fields: [] });
        expect(fixture.nativeElement.querySelector('arc-content-detail')).toBeNull();
        state();
        await settle();
        expect(fixture.nativeElement.querySelector('arc-content-detail')).not.toBeNull();
        expect(text('[data-testid="preview-status"]')).toBe('Connected');
        expect(text('.arc-pv-title')).toBe('Draft preview, updating live');
    });

    it('in the edit-on-page screen\'s frame (?edit=1): draws the page with no strip and leaves clicks to the screen (VE-D14)', async () => {
        await create({ slug: 'events', fields: [{ key: 'events-price', label: 'Price' }] }, '', { edit: '1' });
        expect(component.editMode).toBe(true);
        // Scripts do not run here: a template can show what one would reveal (VE-D55, review M8).
        expect(document.documentElement.classList.contains('arc-editing')).toBe(true);
        document.documentElement.classList.remove('arc-editing');
        expect(fixture.nativeElement.querySelector('[data-testid="preview-strip"]')).toBeNull();
        expect(sent('hello')).toHaveLength(1);
        state();
        await settle();
        expect(fixture.nativeElement.querySelector('arc-content-detail')).not.toBeNull();
        const event = click('[data-arc-field="title"]');
        expect(sent('focus')).toEqual([]);
        expect(event.defaultPrevented).toBe(false);
        expect(fixture.nativeElement.querySelector('[data-testid="preview-note"]')).toBeNull();
        // Forms still never send.
        const submit = new Event('submit', { bubbles: true, cancelable: true });
        fixture.nativeElement.querySelector('form').dispatchEvent(submit);
        expect(submit.defaultPrevented).toBe(true);
    });

    it('shows the language on the editor\'s screen', async () => {
        await create({ slug: 'events', fields: [] });
        state('hi');
        await settle();
        expect(text('.arc-pv-chip')).toBe('Hindi');
    });

    it('keeps the last draft and says so when the editor closes', async () => {
        await create({ slug: 'events', fields: [] });
        state();
        component.onMessage({ kind: 'bye', from: 'editor' });
        await settle();
        expect(text('[data-testid="preview-status"]')).toBe('Editor closed');
        expect(fixture.nativeElement.querySelector('arc-content-detail')).not.toBeNull();
        // An editor that comes back carries on live.
        state();
        await settle();
        expect(text('[data-testid="preview-status"]')).toBe('Connected');
    });

    it('without an editor, shows the saved draft once (VE-D6)', async () => {
        await create({ slug: 'events', fields: [] });
        await (component as any).showSavedDraft();
        await settle();
        expect(drafts.getDraftById).toHaveBeenCalledWith('events', 'e1');
        expect(component.session.live()?.content['title']).toBe('Saved');
        expect(text('[data-testid="preview-status"]')).toBe('Editor closed, showing the saved draft');
        expect(text('.arc-pv-title')).toBe('Saved draft');
    });

    it('an editor\'s draft is never replaced by the saved one', async () => {
        await create({ slug: 'events', fields: [] });
        state();
        await (component as any).showSavedDraft();
        expect(drafts.getDraftById).not.toHaveBeenCalled();
        expect(component.session.live()?.content['title']).toBe('Live');
    });

    it('a new entry with no editor says the draft is not there', async () => {
        id = 'new';
        await create({ slug: 'events', fields: [] });
        await (component as any).showSavedDraft();
        await settle();
        expect(drafts.getDraftById).not.toHaveBeenCalled();
        expect(text('.arc-pv-empty')).toContain('This draft was not found');
    });

    describe('click to field (VE-D8)', () => {
        beforeEach(async () => {
            await create({ slug: 'events', fields: [{ key: 'events-price', label: 'Price' }, { key: 'events-faq', label: 'FAQ' }] });
            state();
            await settle();
            post.mockClear();
        });

        it('a click on a value sends the editor\'s field and says it is ready there', async () => {
            const event = click('[data-arc-field="price"]');
            expect(event.defaultPrevented).toBe(true);
            expect(sent('focus')).toEqual([{ kind: 'focus', key: 'events-price' }]);
            await settle();
            expect(text('[data-testid="preview-note"]')).toBe('Price is ready in the editor');
        });

        it('a click inside a row sends the row', () => {
            click('[data-arc-field="faq"] b');
            expect(sent('focus')).toEqual([{ kind: 'focus', key: 'events-faq', row: 1 }]);
        });

        it('a built-in field is named in the admin language', async () => {
            click('[data-arc-field="title"]');
            await settle();
            expect(sent('focus')).toEqual([{ kind: 'focus', key: 'title' }]);
            expect(text('[data-testid="preview-note"]')).toBe('Title is ready in the editor');
        });

        it('a value the site works out sends nothing', () => {
            const event = click('[data-arc-field="publishedOn"]');
            expect(sent('focus')).toHaveLength(0);
            expect(event.defaultPrevented).toBe(false);
        });

        it('a link opens in a new tab, never in this window; an in-page anchor still works', () => {
            const open = vi.spyOn(window, 'open').mockImplementation(() => null);
            expect(click('#out').defaultPrevented).toBe(true);
            expect(open).toHaveBeenCalledWith('/elsewhere', '_blank', 'noopener');
            expect(click('#anchor').defaultPrevented).toBe(false);
            open.mockRestore();
        });

        it('a form is shown but never sent', () => {
            expect(click('#join').defaultPrevented).toBe(true);
            const submit = new Event('submit', { bubbles: true, cancelable: true });
            fixture.nativeElement.querySelector('form').dispatchEvent(submit);
            expect(submit.defaultPrevented).toBe(true);
        });

        it('the strip\'s own buttons work as buttons', async () => {
            click('[data-testid="preview-phone"]');
            await settle();
            expect(component.phone()).toBe(true);
            expect(fixture.nativeElement.querySelector('.arc-pv-frame.arc-pv-phone')).not.toBeNull();
            expect(sent('focus')).toHaveLength(0);
        });

        it('a field focused in the editor is outlined, and the outline goes', async () => {
            vi.useFakeTimers();
            try {
                component.highlight('events-price');
                const el = fixture.nativeElement.querySelector('[data-arc-field="price"]');
                expect(el.hasAttribute('data-arc-pv-highlight')).toBe(true);
                vi.advanceTimersByTime(2100);
                expect(el.hasAttribute('data-arc-pv-highlight')).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('types without pages (VE2)', () => {
        it('on the home page when it has the type\'s cards, with the place and the last-place note', async () => {
            await create({ slug: 'quotes', hasPublicUrl: false, fields: [] }, HOME_WITH);
            state();
            await settle();
            await new Promise((resolve) => setTimeout(resolve, 100));
            await settle();
            expect(fixture.nativeElement.querySelector('arc-home')).not.toBeNull();
            expect(text('[data-testid="preview-place"]')).toBe('Shown on the home page');
            expect(text('[data-testid="preview-last-place"]')).toContain("takes the last card's place");
        });

        it('a click on the draft\'s card opens its title', async () => {
            await create({ slug: 'quotes', hasPublicUrl: false, fields: [] }, HOME_WITH);
            state();
            await settle();
            post.mockClear();
            click('[data-arc-draft]');
            expect(sent('focus')).toEqual([{ kind: 'focus', key: 'title' }]);
        });

        it('its cards alone when no page shows the type', async () => {
            await create({ slug: 'quotes', hasPublicUrl: false, fields: [] }, '<p>No blocks</p>');
            state();
            await settle();
            expect(text('.cards')).toBe('quotes');
            // No header or footer here to switch the site's stylesheets on: the window does (VE-D3).
            expect((document.getElementById('arc-site-css-main') as HTMLLinkElement).disabled).toBe(false);
            expect((document.getElementById('arc-site-css-site') as HTMLLinkElement).disabled).toBe(false);
            expect(text('[data-testid="preview-place"]')).toBe('Not placed on any page yet: its cards alone');
        });

        it('the cards alone when the home page cannot be read', async () => {
            await create({ slug: 'quotes', hasPublicUrl: false, fields: [] });
            http.get.mockReturnValue(throwError(() => new Error('offline')));
            await (component as any).loadHome();
            state();
            await settle();
            expect(text('.cards')).toBe('quotes');
        });

        it('a type with pages whose cards are on the home page offers it (VE2.4)', async () => {
            await create({ slug: 'quotes', fields: [] }, HOME_WITH);
            state();
            await settle();
            expect(fixture.nativeElement.querySelector('arc-content-detail')).not.toBeNull();
            expect(text('[data-testid="preview-also-on"]')).toBe('Also on: Home page');
            click('[data-testid="preview-also-on"]');
            await settle();
            expect(fixture.nativeElement.querySelector('arc-home')).not.toBeNull();
            expect(text('[data-testid="preview-also-on"]')).toBe('Back to its own page');
            expect(text('[data-testid="preview-place"]')).toBe('');
        });
    });
});
