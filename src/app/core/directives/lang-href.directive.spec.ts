/**
 * Tests for LangHrefDirective.
 *
 * What matters is that the rewrite works off the *authored* href every time,
 * because the directive re-applies whenever the language signal changes and
 * must never compound its own output.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { LangHrefDirective } from './lang-href.directive';
import { UiStringsService } from '../services/ui-strings.service';

@Component({
    standalone: true,
    imports: [LangHrefDirective],
    template: `
        <a href="/">Home</a>
        <a href="/articles">Articles</a>
        <a href="/#features">Features</a>
        <a href="https://example.com">External</a>
        <a>No href</a>
    `,
})
class HostComponent {}

describe('LangHrefDirective', () => {
    let fixture: ComponentFixture<HostComponent>;
    let uiStrings: UiStringsService;

    const hrefs = () =>
        [...fixture.nativeElement.querySelectorAll('a')].map((a: HTMLAnchorElement) =>
            a.getAttribute('href'),
        );

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [HostComponent] });
        uiStrings = TestBed.inject(UiStringsService);
        fixture = TestBed.createComponent(HostComponent);
    });

    it('leaves links untouched on the default language', () => {
        fixture.detectChanges();
        expect(hrefs()).toEqual(['/', '/articles', '/#features', 'https://example.com', null]);
    });

    it('points root-relative links at the active language', () => {
        uiStrings.activeLang.set('hi');
        fixture.detectChanges();
        expect(hrefs()).toEqual(['/hi', '/hi/articles', '/hi#features', 'https://example.com', null]);
    });

    it('rewrites from the authored href rather than its own output', () => {
        uiStrings.activeLang.set('hi');
        fixture.detectChanges();
        uiStrings.activeLang.set('fr');
        fixture.detectChanges();

        // '/hi/fr/articles' would be the bug.
        expect(hrefs()).toEqual(['/fr', '/fr/articles', '/fr#features', 'https://example.com', null]);
    });

    it('restores the authored href when returning to the default language', () => {
        uiStrings.activeLang.set('hi');
        fixture.detectChanges();
        uiStrings.activeLang.set('');
        fixture.detectChanges();

        expect(hrefs()).toEqual(['/', '/articles', '/#features', 'https://example.com', null]);
    });
});
