/**
 * Showing a field in the site look (specs/editor-site-look-spec.md, ES2 and ES3):
 * the look's root and the template's elements around the field, and a read-only
 * view of stored HTML in them (the version preview). The rich text editor builds
 * its own around the editable element with the same function.
 */
import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, effect, inject, input, untracked } from '@angular/core';
import { emailPreviewDocument } from '../../../shared/utils/email-preview';
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

/**
 * The frame's sandbox: no `allow-scripts` and no `allow-same-origin`, so nothing in
 * stored content runs or reaches the admin's session; links open in a new tab, as in
 * the email preview (src/shared/utils/email-preview.ts).
 */
export const STORED_HTML_FRAME_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';

/** Where the stored HTML goes in the frame's markup. */
const SLOT = '<!--arc-stored-html-->';

/**
 * The frame's own styles: no margin of its own, and without a site look the text
 * styles the editor's version preview has always had.
 */
const FRAME_CSS = `html,body{margin:0;background:#fff}
body.arc-plain{padding:0 0.25rem;font-size:0.95rem;line-height:1.7;color:#343a40;overflow-wrap:break-word}
body.arc-plain img{max-width:100%;height:auto;border-radius:0.35rem}
body.arc-plain h1,body.arc-plain h2,body.arc-plain h3,body.arc-plain h4,body.arc-plain h5,body.arc-plain h6{margin-top:1.25rem;margin-bottom:0.5rem;color:#212529}
body.arc-plain p{margin-bottom:0.75rem}
body.arc-plain blockquote{border-left:3px solid #dee2e6;padding-left:1rem;color:#6c757d;margin:1rem 0}
body.arc-plain pre{background:#f8f9fa;padding:1rem;border-radius:0.35rem;overflow-x:auto}`;

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** A component's own styles: Angular scopes each rule to the component's elements. */
const COMPONENT_STYLES = /\[_ng(?:content|host)-/;

/**
 * The admin page's global stylesheets, for the frame: the linked files and the style
 * elements (Bootstrap, the icon fonts, the admin's own and the site look's), without
 * the components' own styles, which only match the admin's elements.
 */
export function pageStyles(doc: Document): string {
    return Array.from(doc.head.querySelectorAll('link[rel~="stylesheet"][href], style'))
        .flatMap((element) => {
            if (element instanceof HTMLLinkElement) return [`<link rel="stylesheet" href="${escapeAttr(element.href)}">`];
            const css = element.textContent ?? '';
            return COMPONENT_STYLES.test(css) ? [] : [`<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`];
        })
        .join('');
}

/**
 * The frame's document: the stored HTML in the look's elements (or in the plain text
 * styles without a look), with the admin page's stylesheets, and links that open in
 * a new tab. The stored HTML is only ever parsed inside the sandboxed frame.
 */
export function storedHtmlDocument(doc: Document, look: SiteLook | null, html: string, styles: string): string {
    let body = SLOT;
    if (look) {
        // Built in a document of its own, which loads nothing and has no ids to avoid.
        const inert = doc.implementation.createHTMLDocument('');
        const { root, inner } = buildLookWrappers(inert, look, look.chain.ancestors);
        const field = inert.createElement(look.chain.body.tag);
        if (look.chain.body.classes.length) field.className = look.chain.body.classes.join(' ');
        field.appendChild(inert.createComment('arc-stored-html'));
        inner.appendChild(field);
        body = root.outerHTML;
    }
    const page = `<!doctype html><html><head><meta charset="utf-8">${styles}<style>${FRAME_CSS}</style></head>`
        + `<body class="${look ? 'arc-look' : 'arc-plain'}">${body}</body></html>`;
    return emailPreviewDocument(page.replace(SLOT, () => html || ''));
}

/**
 * Stored HTML shown read-only in a sandboxed frame, in the site look when there is
 * one (its stylesheet on while it is shown), else in the editor's plain text styles.
 */
@Component({
    selector: 'arc-site-look-view',
    standalone: true,
    template: '',
    host: { class: 'arc-site-look-view' },
    styles: [':host { display: block; } iframe { display: block; width: 100%; height: 70vh; min-height: 320px; border: 0; background: #fff; }'],
})
export class SiteLookViewComponent {
    readonly look = input<SiteLook | null>(null);
    readonly html = input<string>('');
    /** The frame's name for a screen reader. */
    readonly label = input<string>('');

    private host = inject(ElementRef<HTMLElement>);
    private document = inject(DOCUMENT);
    private service = inject(SiteLookService);
    private release: (() => void) | null = null;

    constructor() {
        effect(() => {
            const look = this.look();
            const html = this.html();
            const label = this.label();
            untracked(() => this.render(look, html, label));
        });
        inject(DestroyRef).onDestroy(() => this.release?.());
    }

    private render(look: SiteLook | null, html: string, label: string): void {
        // The look's stylesheet goes on the admin page first, so the frame copies it with the rest.
        const release = look ? this.service.use(look) : null;
        const frame = this.document.createElement('iframe');
        // Before the frame is in the page, so its first document is already sandboxed.
        frame.setAttribute('sandbox', STORED_HTML_FRAME_SANDBOX);
        if (label) frame.title = label;
        frame.srcdoc = storedHtmlDocument(this.document, look, html, pageStyles(this.document));
        (this.host.nativeElement as HTMLElement).replaceChildren(frame);
        this.release?.();
        this.release = release;
    }
}
