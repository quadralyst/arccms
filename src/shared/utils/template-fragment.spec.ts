import { describe, it, expect } from 'vitest';
import { isTemplateFragment } from './template-fragment';
import { isTemplateFragment as isTemplateFragmentServer } from '../../../functions/src/shared/template-fragment';

describe('isTemplateFragment', () => {
    it('accepts real template fragments', () => {
        expect(isTemplateFragment('<article><h1>{{ title }}</h1></article><style>a{}</style>')).toBe(true);
        expect(isTemplateFragment('  <section data-arc-loop="items"><div>{{ title }}</div></section>')).toBe(true);
    });

    it('rejects whole documents, the SPA shell and the 404 page', () => {
        expect(isTemplateFragment('<!DOCTYPE html>\n<html lang="en"><head></head><body><arc-root></arc-root></body></html>')).toBe(false);
        expect(isTemplateFragment('<html><body><arc-not-found><h1>404</h1></arc-not-found></body></html>')).toBe(false);
        expect(isTemplateFragment('<div><arc-not-found></arc-not-found></div>')).toBe(false);
    });

    it('accepts a template whose comments, styles or scripts mention <head> or <body>', () => {
        const fragments = [
            '<!-- Publishing moves <style> into the page\'s <head>. --><article>{{ title }}</article>',
            '<article>{{ title }}</article><style>/* ends up in the <head> */ .post { color: red; }</style>',
            '<article>{{ title }}</article><script>document.querySelector("body"); // runs before </body>\n</script>',
        ];
        for (const html of fragments) {
            expect(isTemplateFragment(html)).toBe(true);
            expect(isTemplateFragmentServer(html)).toBe(true);
        }
    });

    it('still rejects a real <head> outside comments, and agrees with the publish side', () => {
        const page = '<!-- a page --><html><head><title>x</title></head><body></body></html>';
        expect(isTemplateFragment(page)).toBe(false);
        expect(isTemplateFragmentServer(page)).toBe(false);
    });

    it('rejects empty responses', () => {
        expect(isTemplateFragment('')).toBe(false);
        expect(isTemplateFragment('   ')).toBe(false);
        expect(isTemplateFragment(null)).toBe(false);
    });
});
