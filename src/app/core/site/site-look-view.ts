/**
 * Showing a field in the site look (specs/editor-site-look-spec.md, ES2 and ES3):
 * the look's root and the template's elements around the field, built in the
 * admin page, and a read-only view of stored HTML in them (the version preview).
 * The rich text editor builds its own around the editable element with the same
 * function.
 */
import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, effect, inject, input, untracked } from '@angular/core';
import { ChainElement } from './site-look';
import { SiteLook, SiteLookService } from './site-look.service';

/**
 * The look's root (the stand-in for the page's body, with the look's scope class
 * and the edited language) and `ancestors` inside it, outermost first. Returns
 * the root and the innermost element, where the field goes. An id the admin page
 * already has is left off, so the admin's own lookups keep working.
 */
export function buildLookWrappers(doc: Document, look: SiteLook, ancestors: ChainElement[]): { root: HTMLElement; inner: HTMLElement } {
    const root = doc.createElement('div');
    root.className = `arc-site-look ${look.scopeClass}`;
    if (look.lang) root.lang = look.lang;
    let inner: HTMLElement = root;
    for (const element of ancestors) {
        const node = doc.createElement(element.tag);
        if (element.classes.length) node.className = element.classes.join(' ');
        if (element.id && !doc.getElementById(element.id)) node.id = element.id;
        inner.appendChild(node);
        inner = node;
    }
    return { root, inner };
}

/** Stored HTML shown read-only in the site look, its stylesheet on while it is shown. */
@Component({
    selector: 'arc-site-look-view',
    standalone: true,
    template: '',
    host: { class: 'arc-site-look-view' },
    styles: [':host { display: block; }'],
})
export class SiteLookViewComponent {
    readonly look = input.required<SiteLook>();
    readonly html = input<string>('');

    private host = inject(ElementRef<HTMLElement>);
    private document = inject(DOCUMENT);
    private service = inject(SiteLookService);
    private release: (() => void) | null = null;

    constructor() {
        effect(() => {
            const look = this.look();
            const html = this.html();
            untracked(() => this.render(look, html));
        });
        inject(DestroyRef).onDestroy(() => this.release?.());
    }

    private render(look: SiteLook, html: string): void {
        const { root, inner } = buildLookWrappers(this.document, look, look.chain.ancestors);
        const body = this.document.createElement(look.chain.body.tag);
        if (look.chain.body.classes.length) body.className = look.chain.body.classes.join(' ');
        // Stored content, shown as the editor's version preview has always shown it.
        body.innerHTML = html || '';
        inner.appendChild(body);
        const release = this.service.use(look);
        (this.host.nativeElement as HTMLElement).replaceChildren(root);
        this.release?.();
        this.release = release;
    }
}
