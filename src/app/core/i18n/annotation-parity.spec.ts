/**
 * The three `data-arc-t` annotations mean the same thing in all three renderers.
 *
 * There are three places a translated public string is produced: the app's
 * header and footer (applyStringsToElement, on live DOM), the SPA hydrator of
 * templates, and the publish pipeline. They used to support overlapping but
 * different subsets, so an annotation could silently do nothing in one renderer
 * only.
 *
 * This spec is what keeps them symmetric. A renderer that stops supporting one
 * of the three fails here rather than in production, in one language.
 */

import { describe, it, expect } from 'vitest';
import { applyStringsToElement } from './apply-strings-dom';
import { TemplateHydrationService } from '../services/template-hydration.service';
import { TemplateHydrationService as ServerHydration } from '../../../../functions/src/shared/template-hydration';

const STRINGS: Record<string, string> = {
    read_more: 'लेख पढ़ें',
    search_placeholder: 'खोजें',
    min_read: '{{ count }} मिनट का पठन',
};

/** The header and footer renderer, as a string-in, string-out function. */
function onDom(html: string, strings: Record<string, string>): string {
    const host = document.createElement('div');
    host.innerHTML = html;
    applyStringsToElement(host, strings);
    return host.innerHTML;
}

describe('data-arc-t annotations', () => {
    describe('in hydrated templates', () => {
        const HTML = `
            <span data-arc-t="read_more">Read Article</span>
            <input data-arc-t-attr="placeholder:search_placeholder" placeholder="Search">
            <span data-arc-t="min_read" data-arc-t-params='{"count": 5}'>5 min read</span>
        `;

        // Every renderer, so a divergence between any two fails too.
        const renderers: Array<[string, (html: string, s: Record<string, string>) => string]> = [
            ['header and footer', onDom],
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
