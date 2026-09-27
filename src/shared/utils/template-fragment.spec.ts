import { describe, it, expect } from 'vitest';
import { isTemplateFragment } from './template-fragment';

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

    it('rejects empty responses', () => {
        expect(isTemplateFragment('')).toBe(false);
        expect(isTemplateFragment('   ')).toBe(false);
        expect(isTemplateFragment(null)).toBe(false);
    });
});
