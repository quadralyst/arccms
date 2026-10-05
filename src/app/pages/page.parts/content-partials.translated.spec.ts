/**
 * A card block on a translated home page, in the app (B4/B7 in
 * specs/website-docs-review.md): the cards show their translations, link in the
 * page's language and run the template's script once, as when published.
 */
import { TestBed } from '@angular/core/testing';
import { ReadableStream } from 'stream/web';
(global as any).ReadableStream = ReadableStream;
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { ContentPartialsComponent } from './content-partials.component';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { ContentsService } from '../admin/contents/content-store/published-contents.service';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { LocalizationService } from '../../core/services/localization.service';
import { MediaSettingsService } from '../../core/services/media-settings.service';

const TEMPLATE = '<h2>{{ sectionTitle }}</h2><ul data-arc-loop="items"><li><a href="{{ url }}">{{ title }}</a></li></ul>'
    + '<script>window.arcCardRuns = (window.arcCardRuns || 0) + 1;</script>';

describe('ContentPartialsComponent on a translated page', () => {
    const getTranslation = vi.fn();

    beforeEach(async () => {
        vi.useFakeTimers();
        (window as any).arcCardRuns = 0;
        getTranslation.mockImplementation(async (_type: string, id: string) => (id === '1' ? { title: 'पहला' } : null));
        const contents = { items: signal([
            { id: '1', type: 'articles', publishedStatus: true, title: 'First', urlSlug: 'first', publishedOn: { seconds: 2 } },
            { id: '2', type: 'articles', publishedStatus: true, title: 'Second', urlSlug: 'second', publishedOn: { seconds: 1 } },
        ]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [ContentPartialsComponent],
            providers: [
                { provide: ContentTypesStore, useValue: { items: signal([{ slug: 'articles', name: 'Articles' }]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() } },
                { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of(TEMPLATE)) } },
                { provide: ContentsService, useValue: { getTranslation } },
                { provide: UiStringsService, useValue: { activeLang: signal('hi'), strings: signal({ latest_of_type: 'नवीनतम {{ contentType }}' }) } },
                { provide: LocalizationService, useValue: { defaultLanguage: signal('en') } },
                { provide: MediaSettingsService, useValue: { load: vi.fn(), maxSize: signal(1200) } },
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } }, paramMap: of({ get: () => null, keys: [] }), queryParams: of({}) } },
            ],
        })
            .overrideComponent(ContentPartialsComponent, { set: { providers: [{ provide: ContentsStore, useValue: contents }] } })
            .compileComponents();
    });

    it('shows each card\'s translation, linked in the page\'s language, and runs the script once', async () => {
        const fixture = TestBed.createComponent(ContentPartialsComponent);
        fixture.detectChanges();
        await vi.runAllTimersAsync();
        fixture.detectChanges();
        await vi.runAllTimersAsync();

        const html = fixture.componentInstance.templateHtml();
        expect(html).toContain('<a href="/hi/articles/first">पहला</a>');
        expect(html).toContain('<a href="/hi/articles/second">Second</a>');
        expect(html).toContain('नवीनतम Articles');
        expect((window as any).arcCardRuns).toBe(1);
        vi.useRealTimers();
    });
});
