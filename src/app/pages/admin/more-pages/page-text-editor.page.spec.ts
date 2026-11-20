/**
 * The classic editor of the home page or a static page (page-text-editor.page.ts,
 * specs/visual-editing-spec.md VE-D50 to VE-D52).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';
import { setSiteManifestForTesting } from '../../../core/site/site';
import { LocalizationService } from '../../../core/services/localization.service';
import { UiStringsService } from '../../../core/services/ui-strings.service';
import { PageTextService, type PageTextDraft } from '../../../core/site/page-text.service';
import { MorePagesService } from './more-pages.service';
import PageTextEditorPage from './page-text-editor.page';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';

const HOME = `<html><head><title>Bakery</title><meta name="description" content="Bread daily."></head><body>
<section data-arc-label="Welcome">
  <h1 data-arc-edit="hero" data-arc-t="hero_t">Hello</h1>
  <img data-arc-edit="photo" src="/a.jpg" alt="A loaf">
  <a data-arc-edit="cta" href="/menu">Menu</a>
  <div data-arc-edit="intro" data-arc-edit-kind="rich">Baked <b>early</b>.</div>
</section>
<section><h2>Kind words</h2><arc-content-partials content-type="testimonials" count="3"></arc-content-partials></section>
</body></html>`;

describe('PageTextEditorPage', () => {
    let fixture: ComponentFixture<PageTextEditorPage>;
    let session: Record<string, any>;
    let draft: ReturnType<typeof signal<PageTextDraft | null>>;
    let published: ReturnType<typeof vi.fn>;
    let pushPublished: (value: unknown) => void;

    async function open(name = '', languages = [{ code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' }]): Promise<HTMLElement> {
        await TestBed.configureTestingModule({
            imports: [PageTextEditorPage, translocoTestingModule()],
            providers: [
                provideRouter([]),
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (k: string) => (k === 'name' ? name || null : null) } } } },
                { provide: LocalizationService, useValue: { load: vi.fn().mockResolvedValue({ defaultLanguage: 'en', enabledLanguages: languages }) } },
                { provide: UiStringsService, useValue: { load: vi.fn().mockResolvedValue({ hero_t: 'स्वागत' }) } },
                { provide: PageTextService, useValue: { session: vi.fn(() => session), published, followPublished: (_id: string, next: (value: unknown) => void) => { pushPublished = next; next(null); return () => undefined; }, history: vi.fn().mockResolvedValue([]) } },
                { provide: MorePagesService, useValue: {
                    file: vi.fn(async (path: string) => (path.includes('home') || path.includes('about') ? HOME : '')),
                    cardTypes: vi.fn().mockResolvedValue(new Map([['testimonials', { name: 'Testimonials', ownOrder: false }]])),
                } },
                { provide: ConfirmService, useValue: { ask: vi.fn().mockResolvedValue(true) } },
                { provide: MatDialog, useValue: { open: vi.fn(() => ({ afterClosed: () => of({ type: 'submit', mediaUrl: '/media/new.jpg' }) })) } },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(PageTextEditorPage);
        fixture.detectChanges();
        await fixture.whenStable();
        await new Promise((r) => setTimeout(r, 0));
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    const input = (el: HTMLElement, id: string) => el.querySelector<HTMLInputElement>(`#${id}`)!;
    const type = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
        field.value = value;
        field.dispatchEvent(new Event('input'));
    };

    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        setSiteManifestForTesting({ version: 1, home: {}, templates: {}, strings: ['hi'], files: {}, pages: { 'about-us': 'app' } });
        draft = signal<PageTextDraft | null>(null);
        published = vi.fn().mockResolvedValue(null);
        session = {
            draft, loaded: signal(true), error: signal<string | null>(null), open: vi.fn(), close: vi.fn(),
            saveText: vi.fn().mockResolvedValue(undefined), useFileText: vi.fn().mockResolvedValue(undefined),
            saveUrl: vi.fn().mockResolvedValue(undefined), useFileUrl: vi.fn().mockResolvedValue(undefined),
            saveSeo: vi.fn().mockResolvedValue(undefined), useFileSeo: vi.fn().mockResolvedValue(undefined),
            saveShareImage: vi.fn().mockResolvedValue(undefined), useFileShareImage: vi.fn().mockResolvedValue(undefined),
            removeKey: vi.fn().mockResolvedValue(undefined), restore: vi.fn().mockResolvedValue(undefined),
            publish: vi.fn().mockResolvedValue(undefined),
        };
    });
    afterEach(() => {
        vi.useRealTimers();
        setSiteManifestForTesting();
    });

    it('shows a field per marked area, grouped by section, with the file\'s words as placeholders', async () => {
        const el = await open();
        expect(Array.from(el.querySelectorAll('.section-name')).map((h) => h.textContent?.trim())).toEqual(['Welcome', 'Kind words']);
        expect(input(el, 'w-hero').placeholder).toBe('Hello');
        expect(input(el, 'w-photo').placeholder).toBe('A loaf');
        expect(input(el, 'u-cta').placeholder).toBe('/menu');
        expect(el.querySelector('#w-intro')?.getAttribute('contenteditable')).toBe('true');
        expect(el.querySelector('[data-testid="card-block"]')?.textContent).toContain('Testimonials: 3 shown, newest first');
        expect(el.querySelector('[data-testid="languages"]')).not.toBeNull();
        expect(session['open']).toHaveBeenCalled();
    });

    it('shows saved rich words through the allow-list, never a draft\'s script', async () => {
        draft.set({ text: { en: { intro: { value: 'Fresh <b>daily</b><img src=x onerror="alert(1)">', fileText: 'Baked <b>early</b>.' } } } });
        const el = await open();
        fixture.detectChanges();
        const rich = el.querySelector('#w-intro')!;
        expect(rich.innerHTML).toBe('Fresh <b>daily</b>');
        expect(rich.querySelector('img')).toBeNull();
    });

    it('saves a field on its own once typing stops, with the file\'s text (VE-D52, VE-D45)', async () => {
        const el = await open();
        type(input(el, 'w-hero'), 'Hi all');
        expect(session['saveText']).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(800);
        expect(session['saveText']).toHaveBeenCalledWith('en', 'hero', 'Hi all', { fileText: 'Hello' });
    });

    it('saves at once when the field is left, and an emptied field uses the file\'s text again', async () => {
        draft.set({ text: { en: { hero: { value: 'Hi all', fileText: 'Hello' } } } });
        const el = await open();
        expect(input(el, 'w-hero').value).toBe('Hi all');
        type(input(el, 'w-hero'), '  ');
        input(el, 'w-hero').dispatchEvent(new Event('blur'));
        await vi.advanceTimersByTimeAsync(0);
        expect(session['useFileText']).toHaveBeenCalledWith('en', 'hero');
    });

    it('shows others\' saves in a field nobody is typing in', async () => {
        const el = await open();
        draft.set({ text: { en: { hero: { value: 'From someone else' } } } });
        fixture.detectChanges();
        expect(input(el, 'w-hero').value).toBe('From someone else');
    });

    it('refuses an address that cannot be used, and saves one that can', async () => {
        const el = await open();
        type(input(el, 'u-cta'), 'javascript:alert(1)');
        fixture.detectChanges();
        expect(el.textContent).toContain('Use an address that starts with');
        await vi.advanceTimersByTimeAsync(800);
        expect(session['saveUrl']).not.toHaveBeenCalled();
        type(input(el, 'u-cta'), '/p/menu');
        await vi.advanceTimersByTimeAsync(800);
        expect(session['saveUrl']).toHaveBeenCalledWith('cta', '/p/menu', { fileText: '/menu' });
    });

    it('chooses a picture from the media library', async () => {
        const el = await open();
        const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Choose picture'))!;
        button.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(session['saveUrl']).toHaveBeenCalledWith('photo', '/media/new.jpg', { fileText: '/a.jpg' });
    });

    it('says the file has new text, with Use it and Keep mine (VE-D45)', async () => {
        draft.set({ text: { en: { hero: { value: 'Hi all', fileText: 'Hello there' } } } });
        const el = await open();
        expect(el.textContent).toContain('The file has new text');
        Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Keep mine')!.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(session['saveText']).toHaveBeenCalledWith('en', 'hero', 'Hi all', { fileText: 'Hello' });
    });

    it('in another language: the default language\'s words above the field, the translation as placeholder, and the source kept (VE-D44)', async () => {
        draft.set({ text: { en: { hero: { value: 'Hi all' } } } });
        const el = await open();
        fixture.componentInstance.chooseLanguage('hi');
        fixture.detectChanges();
        expect(el.querySelector('[data-area="hero"] .default-words')?.textContent).toContain('Hi all');
        expect(input(el, 'w-hero').placeholder).toBe('स्वागत');
        type(input(el, 'w-hero'), 'नमस्ते');
        await vi.advanceTimersByTimeAsync(800);
        expect(session['saveText']).toHaveBeenCalledWith('hi', 'hero', 'नमस्ते', { fileText: 'Hello', sourceText: 'Hi all' });
    });

    it('saves words still waiting in the language they were typed in, when the language changes', async () => {
        const el = await open();
        type(input(el, 'w-hero'), 'Hi all');
        fixture.componentInstance.chooseLanguage('hi');
        await vi.advanceTimersByTimeAsync(800);
        expect(session['saveText']).toHaveBeenCalledTimes(1);
        expect(session['saveText']).toHaveBeenCalledWith('en', 'hero', 'Hi all', { fileText: 'Hello' });
    });

    it('lists saved keys the file no longer has, and removes one after asking (VE-D47)', async () => {
        draft.set({ text: { en: { old_banner: { value: 'Summer sale' } } } });
        const el = await open();
        expect(el.querySelector('[data-testid="gone"]')?.textContent).toContain('Summer sale');
        Array.from(el.querySelectorAll('[data-testid="gone"] button'))[0].dispatchEvent(new Event('click'));
        await vi.advanceTimersByTimeAsync(0);
        expect(session['removeKey']).toHaveBeenCalledWith('old_banner');
    });

    it('publishes changes through the queue, and only when there are some (VE-D53)', async () => {
        const el = await open();
        const publish = () => el.querySelector<HTMLButtonElement>('[data-testid="publish"]')!;
        expect(publish().disabled).toBe(true);
        draft.set({ text: { en: { hero: { value: 'Hi' } } }, updatedAt: { toMillis: () => 5 } });
        fixture.detectChanges();
        expect(publish().disabled).toBe(false);
        publish().click();
        await vi.advanceTimersByTimeAsync(0);
        expect(session['publish']).toHaveBeenCalled();
        pushPublished({ draftUpdatedAt: { toMillis: () => 5 }, publishedAt: { toMillis: () => 6 } });
        await vi.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        expect(el.querySelector('.panel .page-status')?.textContent).toContain('Published');
    });

    it('edits the title and description in the SEO tab', async () => {
        const el = await open();
        Array.from(el.querySelectorAll<HTMLButtonElement>('.panel-tab')).find((b) => b.textContent?.trim() === 'SEO')!.click();
        fixture.detectChanges();
        expect(input(el, 'seo-title').placeholder).toBe('Bakery');
        type(input(el, 'seo-title'), 'Fresh bread');
        await vi.advanceTimersByTimeAsync(800);
        expect(session['saveSeo']).toHaveBeenCalledWith('en', 'title', 'Fresh bread');
    });

    it('restores a version from History into the draft (VE-D51)', async () => {
        const el = await open();
        const version = { id: 'v1', text: { en: { hero: { value: 'Old' } } }, publishedAt: { toMillis: () => 1 } };
        (TestBed.inject(PageTextService).history as ReturnType<typeof vi.fn>).mockResolvedValue([version]);
        Array.from(el.querySelectorAll<HTMLButtonElement>('.panel-tab')).find((b) => b.textContent?.trim() === 'History')!.click();
        await vi.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        el.querySelector<HTMLButtonElement>('[data-testid="history"] button')!.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(session['restore']).toHaveBeenCalledWith(version);
    });

    it('keeps a failed field\'s words and error when another field saves, and Publish waits', async () => {
        const el = await open();
        session['saveText'].mockImplementation(async (_lang: string, key: string) => {
            if (key === 'hero') throw new Error('refused');
        });
        type(input(el, 'w-hero'), 'Hi all');
        type(input(el, 'w-photo'), 'A fresh loaf');
        const page = fixture.componentInstance;
        expect(await page.flushAll()).toBe(false);
        fixture.detectChanges();
        expect(page.saveError()).toBe('refused');
        expect(input(el, 'w-hero').value).toBe('Hi all');
        expect(el.querySelector('[data-testid="save-error"]')).not.toBeNull();
    });

    it('says when the draft cannot be read, as saving would fail too', async () => {
        session['error'] = signal('Missing or insufficient permissions.');
        const el = await open();
        expect(el.querySelector('[data-testid="read-error"]')?.textContent).toContain('Missing or insufficient permissions.');
    });

    it('has no language switch on a static page, which is in the default language only', async () => {
        const el = await open('about-us');
        expect(el.querySelector('[data-testid="languages"]')).toBeNull();
        expect(TestBed.inject(PageTextService).session).toHaveBeenCalledWith('p-about-us');
    });
});
