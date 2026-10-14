/**
 * Card blocks in the site's header and footer, on the pages the app draws
 * (sign-in, the form pages, search, content pages before they are published):
 * each <arc-content-partials> becomes the card block component, its plain
 * attributes setting its inputs, as on the home page. Publishing fills the same
 * blocks with the same cards (functions/src/pages/card-blocks.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

vi.mock('virtual:arc-site', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    header: '<nav class="site-nav"><arc-content-partials content-type="programs" count="2" section-title="Programs">'
        + '</arc-content-partials></nav>',
    footer: '<footer class="site-footer"><div class="col"><arc-content-partials content-type="entry-points" count="five"'
        + ' template-folder="entry-point"></arc-content-partials></div></footer>',
}));

import { HeaderComponent } from './header.component';
import { FooterComponent } from './footer.component';
import { ContentPartialsComponent } from './content-partials.component';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';

describe('card blocks in the header and footer the app draws', () => {
    beforeEach(async () => {
        const emptyStore = { items: signal([]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() };
        await TestBed.configureTestingModule({
            imports: [HeaderComponent, FooterComponent],
            providers: [
                { provide: ContentTypesStore, useValue: emptyStore },
                { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of('')) } },
                { provide: Router, useValue: { navigate: vi.fn(), events: of(), url: '/' } },
                {
                    provide: ActivatedRoute,
                    useValue: { snapshot: { paramMap: { get: () => null } }, paramMap: of({ get: () => null, keys: [] }), queryParams: of({}) },
                },
            ],
        })
            .overrideComponent(ContentPartialsComponent, {
                set: {
                    providers: [{ provide: ContentsStore, useValue: emptyStore }],
                    // What the block was given, instead of the cards.
                    template: '<i class="given">{{ contentType() }}|{{ count() }}|{{ sectionTitle() }}|{{ templateFolder() }}</i>',
                },
            })
            .compileComponents();
    });

    it('turns the header\'s card block into the component, with its attributes as inputs', () => {
        const fixture = TestBed.createComponent(HeaderComponent);
        fixture.detectChanges();
        const block = (fixture.nativeElement as HTMLElement).querySelector('nav arc-content-partials .given');
        expect(block?.textContent).toBe('programs|2|Programs|');
    });

    it('does the same in the footer: a count that is not a number gives 4', () => {
        const fixture = TestBed.createComponent(FooterComponent);
        fixture.detectChanges();
        const block = (fixture.nativeElement as HTMLElement).querySelector('footer .col arc-content-partials .given');
        expect(block?.textContent).toBe('entry-points|4||entry-point');
    });
});

describe('ContentPartialsComponent.attributeInputs', () => {
    it('reads the four attributes, and only those present', () => {
        const element = document.createElement('arc-content-partials');
        element.setAttribute('content-type', 'services');
        element.setAttribute('count', '12');
        element.setAttribute('section-title', 'What we do');
        element.setAttribute('data-other', 'x');
        expect(ContentPartialsComponent.attributeInputs(element)).toEqual({ contentType: 'services', count: 12, sectionTitle: 'What we do' });
        element.setAttribute('template-folder', 'cards');
        element.setAttribute('count', '0');
        expect(ContentPartialsComponent.attributeInputs(element)).toMatchObject({ count: 4, templateFolder: 'cards' });
    });
});
