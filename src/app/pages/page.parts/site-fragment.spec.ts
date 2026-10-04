/**
 * renderSiteFragment: the header and footer are the site's plain HTML, rendered
 * the way publishing renders them (specs/own-website-spec.md, W-D12).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { renderSiteFragment } from './site-fragment';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { header, footer } from 'virtual:arc-site';

@Component({ selector: 'arc-stub-search', standalone: true, template: '<input class="stub-search">' })
class StubSearchComponent {}

const HTML = `
    <nav>
        <a href="/articles" data-arc-t="nav_articles">Articles</a>
        <a href="https://example.com/x">Out</a>
        <span class="braces">{ not a binding } and @home</span>
        <arc-search></arc-search>
    </nav>`;

@Component({ selector: 'arc-test-fragment', standalone: true, template: '' })
class FragmentHostComponent {
    constructor() {
        renderSiteFragment(HTML, { 'arc-search': StubSearchComponent });
    }
}

describe('renderSiteFragment', () => {
    let activeLang: ReturnType<typeof signal<string>>;
    let strings: ReturnType<typeof signal<Record<string, string>>>;

    beforeEach(() => {
        activeLang = signal('');
        strings = signal<Record<string, string>>({});
        TestBed.configureTestingModule({
            providers: [{ provide: UiStringsService, useValue: { activeLang, strings } }],
        });
    });

    function render(): HTMLElement {
        const fixture = TestBed.createComponent(FragmentHostComponent);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    it('renders the HTML as written, braces and @ included', () => {
        const el = render();
        expect(el.querySelector('.braces')!.textContent).toBe('{ not a binding } and @home');
        expect(el.querySelector('a')!.textContent).toBe('Articles');
    });

    it('turns Arc CMS elements into their components', () => {
        expect(render().querySelector('arc-search .stub-search')).toBeTruthy();
    });

    it('translates and points links at the page\'s language, and follows a change of language', () => {
        const fixture = TestBed.createComponent(FragmentHostComponent);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('a')!.getAttribute('href')).toBe('/articles');

        activeLang.set('hi');
        strings.set({ nav_articles: 'लेख' });
        fixture.detectChanges();

        const [inner, outer] = Array.from(el.querySelectorAll('a'));
        expect(inner.textContent).toBe('लेख');
        expect(inner.getAttribute('href')).toBe('/hi/articles');
        expect(outer.getAttribute('href')).toBe('https://example.com/x');
        expect(el.querySelector('arc-search .stub-search')).toBeTruthy();
    });
});

describe('the header and footer files', () => {
    it('are the site\'s own HTML, with no Angular syntax left to compile', () => {
        for (const html of [header, footer]) {
            expect(html.trim()).not.toBe('');
            expect(html).not.toMatch(/\[[a-zA-Z.]+\]=|\([a-z]+\)=|\*ng|@if|@for/);
        }
        expect(header).toContain('<arc-search>');
        expect(header).toContain('<arc-language-switcher>');
    });
});
