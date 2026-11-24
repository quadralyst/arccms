/**
 * The sign-in page's stylesheet, asked for as /signup opens (scripts/vite-sign-in-sheet.ts, F51).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signInSheetUrl, siteContents } from '../arc-site.mjs';
import { signInSheet, signInSheetScript } from '../vite-sign-in-sheet';

let root: string;
const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
};

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'arc-sign-in-sheet-'));
    write('public/assets/css/site.css', '');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Runs the script as the browser would at an address; returns the link it added, or null. */
function runAt(pathname: string, script: string): Record<string, string> | null {
    let added: Record<string, string> | null = null;
    const document = { createElement: () => ({}), head: { appendChild: (link: Record<string, string>) => { added = link; } } };
    new Function('location', 'document', script)({ pathname }, document);
    return added;
}

describe('the sign-in page\'s stylesheet address', () => {
    it('is none for an app with no styles of its own: Arc CMS ships an empty site.css', () => {
        expect(signInSheetUrl(root)).toBeNull();
        expect(signInSheet(root).transformIndexHtml).toBeTypeOf('function');
        expect((signInSheet(root).transformIndexHtml as () => unknown[])()).toEqual([]);
    });

    it('is the app\'s site.css, or its sign-in.css, with the version the page links it with', () => {
        write('src/custom/site/site.css', ':root{--a:1}');
        const versions = () => siteContents(root).manifest.files as Record<string, string>;
        expect(signInSheetUrl(root)).toBe(`/assets/css/site.css?v=${versions()['assets/css/site.css']}`);
        write('src/custom/site/sign-in.css', ':root{--a:2} .x{background:url(/site/a.webp)}');
        write('src/custom/site/assets/a.webp', 'image');
        expect(signInSheetUrl(root)).toBe(`/assets/css/sign-in.css?v=${versions()['assets/css/sign-in.css']}`);
    });

    it('is none when the app\'s sign-in.css is empty', () => {
        write('src/custom/site/site.css', ':root{--a:1}');
        write('src/custom/site/sign-in.css', '');
        expect(signInSheetUrl(root)).toBeNull();
    });
});

describe('the script in the served page', () => {
    const script = signInSheetScript('/assets/css/site.css?v=0123456789abcdef');

    it('asks for the file on the sign-in page only', () => {
        for (const path of ['/signup', '/signup/']) {
            expect(runAt(path, script)).toEqual({ rel: 'preload', as: 'style', href: '/assets/css/site.css?v=0123456789abcdef' });
        }
        for (const path of ['/', '/admin', '/signup-forms', '/user/signup', '/hi/signup']) expect(runAt(path, script)).toBeNull();
    });

    it('goes first in the head: after a stylesheet it would wait for that to load', () => {
        write('src/custom/site/site.css', ':root{--a:1}');
        const tags = (signInSheet(root).transformIndexHtml as () => { tag: string; children: string; injectTo: string }[])();
        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ tag: 'script', injectTo: 'head-prepend' });
        expect(tags[0].children).toContain(signInSheetUrl(root));
    });
});
