/**
 * Showing stored HTML in the site look (site-look-view.ts, specs/editor-site-look-spec.md
 * ES3): the version preview sits in the template's elements, with the look's
 * stylesheet on while it is shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LOOK_PART_CSS, STORED_HTML_FRAME_SANDBOX, SiteLookViewComponent, buildLookWrappers, pageStyles, storedHtmlDocument } from './site-look-view';
import { readFileSync } from 'node:fs';
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
    look = signal<SiteLook | null>(LOOK);
    html = signal('<p>Version <strong>two</strong></p>');
}

describe('buildLookWrappers', () => {
    it('builds the root and the elements inside it, outermost first, and gives the innermost', () => {
        const { root, inner } = buildLookWrappers(document, LOOK, LOOK.chain.ancestors);
        expect(root.className).toBe('arc-site-look arc-site-look-3');
        expect(root.lang).toBe('hi');
        // Each marked: they stand without the parts beside them on the page, and take the whole row of a grid.
        expect(root.innerHTML).toBe('<article class="page" id="top" data-arc-look-part=""><div class="wrapper" data-arc-look-part=""></div></article>');
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

    const frameOf = (fixture: ReturnType<typeof render>) => fixture.nativeElement.querySelector('arc-site-look-view iframe') as HTMLIFrameElement;

    it('shows the HTML in the template\'s elements, in a sandboxed frame, with the look\'s stylesheet on', () => {
        const fixture = render();
        const view = fixture.nativeElement.querySelector('arc-site-look-view') as HTMLElement;
        // Nothing of the stored HTML is drawn into the admin page itself.
        expect(view.children).toHaveLength(1);
        const frame = frameOf(fixture);
        expect(frame.getAttribute('sandbox')).toBe(STORED_HTML_FRAME_SANDBOX);
        expect(frame.getAttribute('sandbox')).not.toMatch(/allow-scripts|allow-same-origin/);
        expect(frame.srcdoc).toContain(
            '<div class="arc-site-look arc-site-look-3" lang="hi"><article class="page" id="top" data-arc-look-part=""><div class="wrapper" data-arc-look-part="">'
            + '<section class="article-content" data-arc-look-part=""><p>Version <strong>two</strong></p></section></div></article></div>',
        );
        expect(service.use).toHaveBeenCalledWith(LOOK);
    });

    it('shows another version or look in place, releasing the previous stylesheet', () => {
        const fixture = render();
        fixture.componentInstance.html.set('<p>Version one</p>');
        fixture.detectChanges();
        const view = fixture.nativeElement.querySelector('arc-site-look-view') as HTMLElement;
        expect(view.querySelectorAll('iframe')).toHaveLength(1);
        expect(frameOf(fixture).srcdoc).toContain('<section class="article-content" data-arc-look-part=""><p>Version one</p></section>');
        expect(service.use).toHaveBeenCalledTimes(2);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('shows the HTML in plain text styles without a look, with no stylesheet to put on', () => {
        const fixture = render();
        fixture.componentInstance.look.set(null);
        fixture.detectChanges();
        expect(frameOf(fixture).srcdoc).toContain('<body class="arc-plain"><p>Version <strong>two</strong></p></body>');
        expect(service.use).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('releases the stylesheet when the preview closes', () => {
        const fixture = render();
        fixture.componentInstance.shown.set(false);
        fixture.detectChanges();
        expect(release).toHaveBeenCalledTimes(1);
    });
});

describe('storedHtmlDocument', () => {
    it('copies the admin page\'s global stylesheets, not the components\' own', () => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/assets/index-abc.css';
        const global = document.createElement('style');
        global.textContent = '.btn{color:red}';
        const component = document.createElement('style');
        component.textContent = '.card[_ngcontent-ng-c1]{color:blue}';
        document.head.append(link, global, component);
        const styles = pageStyles(document);
        [link, global, component].forEach((element) => element.remove());
        expect(styles).toContain(`<link rel="stylesheet" href="${new URL('/assets/index-abc.css', document.baseURI).href}">`);
        expect(styles).toContain('<style>.btn{color:red}</style>');
        expect(styles).not.toContain('_ngcontent');
    });

    it('opens links in a new tab and keeps the stored HTML as written', () => {
        const page = storedHtmlDocument(document, null, '<p><a href="/pricing">Prices</a> <a href="javascript:alert(1)">x</a></p>', '');
        expect(page).toContain('<base target="_blank">');
        expect(page).toContain('<a href="/pricing" target="_blank" rel="noopener noreferrer">Prices</a>');
        expect(page).not.toContain('javascript:');
    });

    it('gives the field the whole row of a grid made for parts the preview does not show, as the editor does', () => {
        const page = storedHtmlDocument(document, LOOK, '<p>Text</p>', '');
        expect(page).toContain('<section class="article-content" data-arc-look-part=""><p>Text</p></section>');
        expect(page).toContain(LOOK_PART_CSS);
        expect(storedHtmlDocument(document, null, '<p>Text</p>', '')).not.toContain(LOOK_PART_CSS);
        // The editor's stylesheet has the same rule for the editable text.
        const editorCss = readFileSync('src/shared/components/tiptap-editor/tiptap-editor.component.scss', 'utf8');
        expect(editorCss).toMatch(/\[data-arc-look-part\] \{\s*grid-column: 1 \/ -1 !important;\s*grid-row: auto !important;/);
    });

    it('never parses the stored HTML in the admin page', () => {
        const before = document.querySelectorAll('img').length;
        storedHtmlDocument(document, LOOK, '<img src="x" onerror="window.hacked = 1">', '');
        expect(document.querySelectorAll('img').length).toBe(before);
        expect((window as { hacked?: number }).hacked).toBeUndefined();
    });
});
