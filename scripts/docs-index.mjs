#!/usr/bin/env node
/**
 * `npm run docs:index`: rewrite docs/assets/search-index.js from the pages in docs/
 * (titles, descriptions and headings, in navigation order). Run it after adding,
 * renaming or retitling a page or a heading; a test fails when the file is stale.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadSite, renderIndex } from './docs-lib.mjs';

export function main() {
    const site = loadSite();
    const next = renderIndex(site);
    let current = null;
    try {
        current = readFileSync(site.indexFile, 'utf8');
    } catch {
        /* first run */
    }
    if (current === next) {
        console.log('docs:index: search-index.js is up to date');
        return;
    }
    writeFileSync(site.indexFile, next);
    console.log(`docs:index: wrote docs/assets/search-index.js (${site.pages.length} pages)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
