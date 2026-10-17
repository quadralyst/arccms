/**
 * The page header on a phone (F26). jsdom cannot lay a page out, so this checks the rules
 * that keep the title and the bell on one line, read from the component's source. Measured
 * in a browser at 375 and 402 wide: no empty band above the first card.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'page-header.component.ts'), 'utf8');
const phone = source.slice(source.indexOf('@media (max-width: 768px)'));

describe('the page header on a phone', () => {
    it('stays a row, as a column turned the title\'s 280px basis into an empty band 280px tall', () => {
        expect(phone).not.toContain('flex-direction: column');
        expect(phone).toContain('.lead { flex: 1 1 8rem; }');
    });

    it('lets the title and the bell share a line, and keeps the search box on a line of its own', () => {
        expect(phone).toContain('align-items: center');
        expect(phone).toContain('.search-slot { width: 100%; order: -1; }');
        expect(phone).toContain('.actions:has(.search-slot:not(:empty)) { flex: 1 1 100%; }');
    });
});
