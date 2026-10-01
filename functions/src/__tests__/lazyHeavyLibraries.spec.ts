/**
 * Every function loads the whole codebase on a cold start, so a slow library
 * imported at the top of any file slows the start of every function, sign-in
 * included. googleapis and cheerio are loaded where they are used instead
 * (docs/app/functions.html, "Keep cold starts short"). A type-only import costs nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLOW = ['googleapis', 'cheerio'];

function sources(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== '__tests__' && entry !== 'node_modules') sources(full, acc);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
            acc.push(full);
        }
    }
    return acc;
}

describe('slow libraries load on first use', () => {
    it('no file imports googleapis or cheerio at the top, except as types', () => {
        const offenders: string[] = [];
        for (const file of sources(SRC)) {
            for (const line of readFileSync(file, 'utf-8').split('\n')) {
                const from = line.match(/^\s*(?:import|export)\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/);
                if (from && SLOW.some((lib) => from[1] === lib || from[1].startsWith(`${lib}/`))) {
                    offenders.push(`${relative(SRC, file)}: ${line.trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('the lazy cheerio loader parses HTML', async () => {
        const { loadHtml } = await import('../shared/lazy-cheerio.js');
        expect(loadHtml('<p class="x">hi</p>')('p.x').text()).toBe('hi');
    });
});
