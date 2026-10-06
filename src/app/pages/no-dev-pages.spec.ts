/**
 * Every file in src/app/pages that the router publishes is a real page. A developer's
 * test or demo page (such as the old /tiptap-test, removed 2026-10-06) would be public
 * and drag admin-only code, like the content editor, into what visitors download.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PAGES = __dirname;

function pageFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return pageFiles(path);
        return name.endsWith('.page.ts') ? [path] : [];
    });
}

describe('published pages', () => {
    it('include no test, demo or playground page', () => {
        const dev = pageFiles(PAGES)
            .map((file) => relative(PAGES, file))
            .filter((file) => /(^|[/(.-])(test|tests|demo|playground|sandbox)([).-]|\.page\.ts$)/i.test(file));
        expect(dev).toEqual([]);
    });
});
