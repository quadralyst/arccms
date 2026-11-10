import { Component, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreviewLinksDirective } from './preview-links.directive';

@Component({
    standalone: true,
    imports: [PreviewLinksDirective],
    template: `<div arcPreviewLinks [innerHTML]="html"></div><a id="outside" href="#elsewhere">out</a>`,
})
class Host {
    // As the previews draw it: trusted, or the sanitizer would take the ids and the form.
    html = inject(DomSanitizer).bypassSecurityTrustHtml('<p id="text">words <a id="link" href="/admin/dashboard"><b id="inside">the page</b></a></p><form id="form"></form>');
}

function press(id: string, type = 'click'): boolean {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true });
    fixture.nativeElement.querySelector(`#${id}`).dispatchEvent(event);
    return event.defaultPrevented;
}

describe('PreviewLinksDirective', () => {
    it('keeps a click on a link, or on what is inside it, on the page', () => {
        expect(press('link')).toBe(true);
        expect(press('inside')).toBe(true);
    });

    it('stops a middle click opening a tab', () => {
        expect(press('link', 'auxclick')).toBe(true);
    });

    it('leaves a click on the words, and a link outside the preview, alone', () => {
        expect(press('text')).toBe(false);
        expect(press('outside')).toBe(false);
    });

    it('finds a link inside a shadow root, as the page look draws it', () => {
        const fixture = TestBed.createComponent(Host);
        fixture.detectChanges();
        const host = fixture.nativeElement.querySelector('[arcPreviewLinks]') as HTMLElement;
        const inner = document.createElement('div');
        host.appendChild(inner);
        inner.attachShadow({ mode: 'open' }).innerHTML = '<a id="shadow" href="/x">x</a>';
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
        inner.shadowRoot!.querySelector('#shadow')!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it('does not let a form in a raw block submit the page', () => {
        const fixture = TestBed.createComponent(Host);
        fixture.detectChanges();
        const event = new Event('submit', { bubbles: true, cancelable: true });
        fixture.nativeElement.querySelector('#form').dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it('is on every email drawn into an admin page', () => {
        const root = resolve(__dirname, '../../..');
        for (const [file, marker] of [
            ['shared/components/email-block-editor/email-block-editor.component.html', '[innerHTML]="previewHtml()"'],
            ['app/pages/admin/(email-brand)/brand-kit.page.html', '[innerHTML]="previewHtml()"'],
            ['app/pages/admin/(email-composer)/email-composer.page.html', '[innerHTML]="t.template"'],
            ['shared/components/broadcast-email-editor/send-broadcast-email/send-broadcast-email.component.html', '[innerHTML]="previewContent"'],
            ['shared/components/test-email/test-email.component.html', '[innerHTML]="previewContent"'],
        ]) {
            const html = readFileSync(resolve(root, file), 'utf8');
            const tag = html.slice(html.lastIndexOf('<', html.indexOf(marker)), html.indexOf(marker));
            expect(tag, file).toContain('arcPreviewLinks');
        }
        // The editor's version preview is in a sandboxed frame instead (site-look-view.ts).
    });
});
