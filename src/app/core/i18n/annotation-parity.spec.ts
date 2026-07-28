/**
 * The three `data-arc-t` annotations mean the same thing in all three renderers.
 *
 * There are three places a translated public string is produced: the Angular
 * directives (the shared header/footer partials), the SPA hydrator, and the
 * publish pipeline. They used to support overlapping-but-different subsets —
 * `data-arc-t-attr` worked in the hydrators but not the directive,
 * `data-arc-t-params` the other way round — so an annotation could silently do
 * nothing in one renderer only.
 *
 * This spec is what keeps them symmetric. A renderer that stops supporting one
 * of the three fails here rather than in production, in one language.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ArcTranslateDirective, ArcTranslateAttrDirective } from '../directives/arc-translate.directive';
import { UiStringsService } from '../services/ui-strings.service';
import { TemplateHydrationService } from '../services/template-hydration.service';
import { TemplateHydrationService as ServerHydration } from '../../../../functions/src/shared/template-hydration';

const STRINGS: Record<string, string> = {
    read_more: 'लेख पढ़ें',
    search_placeholder: 'खोजें',
    min_read: '{{ count }} मिनट का पठन',
};

@Component({
    standalone: true,
    imports: [ArcTranslateDirective, ArcTranslateAttrDirective],
    template: `
        <span id="text" data-arc-t="read_more">Read Article</span>
        <input id="attr" data-arc-t-attr="placeholder:search_placeholder" placeholder="Search">
        <span id="params" data-arc-t="min_read" [data-arc-t-params]="{ count: 5 }">5 min read</span>
    `,
})
class HostComponent {}

describe('data-arc-t annotations', () => {
    describe('in Angular templates (the shared partials)', () => {
        let strings: ReturnType<typeof signal<Record<string, string>>>;

        beforeEach(() => {
            strings = signal<Record<string, string>>(STRINGS);
            TestBed.configureTestingModule({
                providers: [{
                    provide: UiStringsService,
                    useValue: {
                        strings,
                        translate: (key: string, fallback: string) => {
                            const value = strings()[key];
                            return typeof value === 'string' && value.trim() ? value : fallback;
                        },
                    },
                }],
            });
        });

        function render() {
            const fixture = TestBed.createComponent(HostComponent);
            fixture.detectChanges();
            return fixture.nativeElement as HTMLElement;
        }

        it('translates text', () => {
            expect(render().querySelector('#text')!.textContent).toBe('लेख पढ़ें');
        });

        it('translates an attribute', () => {
            expect(render().querySelector('#attr')!.getAttribute('placeholder')).toBe('खोजें');
        });

        it('fills {{ }} from params', () => {
            expect(render().querySelector('#params')!.textContent).toBe('5 मिनट का पठन');
        });

        it('keeps the authored English for a key with no translation', () => {
            strings.set({});
            const host = render();
            expect(host.querySelector('#text')!.textContent).toBe('Read Article');
            expect(host.querySelector('#attr')!.getAttribute('placeholder')).toBe('Search');
        });
    });

    describe('in hydrated templates', () => {
        const HTML = `
            <span data-arc-t="read_more">Read Article</span>
            <input data-arc-t-attr="placeholder:search_placeholder" placeholder="Search">
            <span data-arc-t="min_read" data-arc-t-params='{"count": 5}'>5 min read</span>
        `;

        // Both hydrators, so a divergence between them fails too.
        const renderers: Array<[string, (html: string, s: Record<string, string>) => string]> = [
            ['SPA', (html, s) => TemplateHydrationService.applyStrings(html, s)],
            ['publish pipeline', (html, s) => ServerHydration.applyStrings(html, s)],
        ];

        it.each(renderers)('%s translates text, attributes and params', (_name, apply) => {
            const out = apply(HTML, STRINGS);

            expect(out).toContain('लेख पढ़ें');
            expect(out).toContain('placeholder="खोजें"');
            expect(out).toContain('5 मिनट का पठन');
        });

        it.each(renderers)('%s keeps the authored English when untranslated', (_name, apply) => {
            const out = apply(HTML, {});

            expect(out).toContain('Read Article');
            expect(out).toContain('placeholder="Search"');
        });

        it.each(renderers)('%s strips every annotation from the output', (_name, apply) => {
            const out = apply(HTML, STRINGS);

            // These are ours; a published page must not carry them.
            expect(out).not.toContain('data-arc-t=');
            expect(out).not.toContain('data-arc-t-attr');
            expect(out).not.toContain('data-arc-t-params');
        });

        it.each(renderers)('%s strips params even when the JSON is broken', (_name, apply) => {
            const out = apply(`<span data-arc-t="read_more" data-arc-t-params='oops'>x</span>`, STRINGS);

            expect(out).toContain('लेख पढ़ें');
            expect(out).not.toContain('data-arc-t-params');
        });
    });
});
