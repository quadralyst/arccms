import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { PublicSearchComponent } from './public-search.component';
import { LocalizationService } from '../../core/services/localization.service';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { SearchService } from '../../core/services/search.service';

describe('PublicSearchComponent', () => {
    const activeLang = signal('');
    const strings = signal<Record<string, string>>({});

    beforeEach(async () => {
        activeLang.set('');
        strings.set({});
        await TestBed.configureTestingModule({
            imports: [PublicSearchComponent],
            providers: [
                { provide: LocalizationService, useValue: { load: vi.fn().mockResolvedValue({}), defaultLanguage: () => 'en' } },
                { provide: UiStringsService, useValue: { activeLang, strings } },
                { provide: SearchService, useValue: { isSearchable: () => false, search: vi.fn() } },
                { provide: Router, useValue: { navigateByUrl: vi.fn() } },
            ],
        }).compileComponents();
    });

    it('searches the default language at the root results page with English defaults', () => {
        const fixture = TestBed.createComponent(PublicSearchComponent);
        fixture.detectChanges();
        const box = fixture.debugElement.children[0].componentInstance;
        expect(box.scope).toBe('public');
        expect(box.lang).toBe('en');
        expect(box.resultsUrl).toBe('/search');
        expect(box.navigation).toBe('location');
        expect(box.placeholder).toBe('Search');
    });

    it('follows the page language and its strings', () => {
        activeLang.set('hi');
        strings.set({ search_placeholder: 'खोजें', search_empty: '' });
        const fixture = TestBed.createComponent(PublicSearchComponent);
        fixture.detectChanges();
        const box = fixture.debugElement.children[0].componentInstance;
        expect(box.lang).toBe('hi');
        expect(box.resultsUrl).toBe('/hi/search');
        expect(box.placeholder).toBe('खोजें');
        expect(box.emptyText).toBe('No results');
    });
});
