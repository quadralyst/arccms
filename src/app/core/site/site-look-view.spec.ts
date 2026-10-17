/**
 * Showing stored HTML in the site look (site-look-view.ts, specs/editor-site-look-spec.md
 * ES3): the version preview sits in the template's elements, with the look's
 * stylesheet on while it is shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SiteLookViewComponent, buildLookWrappers } from './site-look-view';
import { SiteLook, SiteLookService } from './site-look.service';

const LOOK: SiteLook = {
    chain: {
        ancestors: [{ tag: 'article', classes: ['page'], id: 'top' }, { tag: 'div', classes: ['wrapper'], id: null }],
        body: { tag: 'section', classes: ['article-content'], id: null },
    },
    scopeClass: 'arc-site-look-3',
    lang: 'hi',
};

@Component({
    standalone: true,
    imports: [SiteLookViewComponent],
    template: `@if (shown()) { <arc-site-look-view [look]="look()" [html]="html()" /> }`,
})
class HostComponent {
    shown = signal(true);
    look = signal<SiteLook>(LOOK);
    html = signal('<p>Version <strong>two</strong></p>');
}

describe('buildLookWrappers', () => {
    it('builds the root and the elements inside it, outermost first, and gives the innermost', () => {
        const { root, inner } = buildLookWrappers(document, LOOK, LOOK.chain.ancestors);
        expect(root.className).toBe('arc-site-look arc-site-look-3');
        expect(root.lang).toBe('hi');
        expect(root.innerHTML).toBe('<article class="page" id="top"><div class="wrapper"></div></article>');
        expect(inner.className).toBe('wrapper');
    });

    it('gives the root itself when there is nothing around the field, and leaves off an id the page has', () => {
        const taken = document.createElement('div');
        taken.id = 'top';
        document.body.appendChild(taken);
        const { root, inner } = buildLookWrappers(document, { ...LOOK, lang: '' }, LOOK.chain.ancestors.slice(0, 1));
        expect(root.hasAttribute('lang')).toBe(false);
        expect((root.firstElementChild as HTMLElement).id).toBe('');
        taken.remove();
        const bare = buildLookWrappers(document, LOOK, []);
        expect(bare.inner).toBe(bare.root);
    });
});

describe('SiteLookViewComponent', () => {
    const release = vi.fn();
    const service = { use: vi.fn(() => release) };

    beforeEach(() => {
        release.mockClear();
        service.use.mockClear();
        TestBed.configureTestingModule({ providers: [{ provide: SiteLookService, useValue: service }] });
    });
    afterEach(() => TestBed.resetTestingModule());

    function render() {
        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        return fixture;
    }

    it('shows the HTML in the template\'s elements, with the look\'s stylesheet on', () => {
        const fixture = render();
        const view = fixture.nativeElement.querySelector('arc-site-look-view') as HTMLElement;
        expect(view.innerHTML).toBe(
            '<div class="arc-site-look arc-site-look-3" lang="hi"><article class="page" id="top"><div class="wrapper">'
            + '<section class="article-content"><p>Version <strong>two</strong></p></section></div></article></div>',
        );
        expect(service.use).toHaveBeenCalledWith(LOOK);
    });

    it('shows another version or look in place, releasing the previous stylesheet', () => {
        const fixture = render();
        fixture.componentInstance.html.set('<p>Version one</p>');
        fixture.detectChanges();
        const view = fixture.nativeElement.querySelector('arc-site-look-view') as HTMLElement;
        expect(view.querySelectorAll('.arc-site-look')).toHaveLength(1);
        expect(view.querySelector('.article-content')!.innerHTML).toBe('<p>Version one</p>');
        expect(service.use).toHaveBeenCalledTimes(2);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('releases the stylesheet when the preview closes', () => {
        const fixture = render();
        fixture.componentInstance.shown.set(false);
        fixture.detectChanges();
        expect(release).toHaveBeenCalledTimes(1);
    });
});
