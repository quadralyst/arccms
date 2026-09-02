/**
 * Points a partial's root-relative links at the page's language.
 *
 * The header and footer are one file shared by every language — their text is
 * translated in place by `data-arc-t`, but their links are written `/articles`
 * and would send a visitor reading Hindi straight back into English. The
 * publish pipeline rewrites them with `prefixAnchorHrefs` when it bakes the
 * partial into a static page; this is the same rewrite for the Angular copy.
 *
 * Scoped by import rather than applied globally: it belongs to the two
 * components that render those shared partials, not to every anchor in the
 * app. Anchors elsewhere — the language switcher, the content templates —
 * already build their own prefixed URLs.
 *
 * Spec: docs/multilingual-spec.md — Phase M5.5.
 */

import { Directive, ElementRef, OnInit, Renderer2, effect, inject } from '@angular/core';
import { UiStringsService } from '../services/ui-strings.service';
import { withLangPrefix } from '../utils/language-links';

@Directive({
    selector: 'a[href]',
    standalone: true,
})
export class LangHrefDirective implements OnInit {
    private element = inject(ElementRef<HTMLAnchorElement>);
    private renderer = inject(Renderer2);
    private uiStrings = inject(UiStringsService);

    /**
     * The authored href, kept so the rewrite is always applied to the original
     * rather than to its own output.
     */
    private authored: string | null = null;

    constructor() {
        // Covers a language becoming known after this anchor rendered. The
        // apply in ngOnInit is what makes prerendering correct, since a
        // prerendered page is serialized without waiting for effects.
        effect(() => {
            this.uiStrings.activeLang();
            this.apply();
        });
    }

    ngOnInit(): void {
        this.apply();
    }

    private apply(): void {
        const anchor = this.element.nativeElement as HTMLAnchorElement;
        if (this.authored === null) {
            this.authored = anchor.getAttribute('href');
        }
        if (this.authored === null) return;

        const lang = this.uiStrings.activeLang();
        this.renderer.setAttribute(
            anchor,
            'href',
            withLangPrefix(this.authored, lang ? `/${lang}` : ''),
        );
    }
}
