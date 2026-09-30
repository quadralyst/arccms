#!/usr/bin/env node
/**
 * `npm run docs:lint -- docs/contributing/writing-docs.html ...`: run the page-level docs checks on
 * the pages you name (page shape, links, paths in <code>, writing rules, the sections of a
 * feature page). It does not check navigation or the search index, so it works on a page
 * you have just written, before it is listed. `npm run check:docs` checks everything.
 */
import { pathToFileURL } from 'node:url';
import { lintPages } from './docs-checks.mjs';
import { loadSite } from './docs-lib.mjs';

export function main(argv = process.argv.slice(2)) {
    const paths = argv.map((a) => a.replace(/^\.?\/?docs\//, ''));
    if (!paths.length) {
        console.error('Usage: npm run docs:lint -- docs/contributing/writing-docs.html [more pages]');
        return 2;
    }
    const site = loadSite();
    const known = new Set(site.pages.map((p) => p.path));
    const missing = paths.filter((p) => !known.has(p));
    if (missing.length) {
        console.error(`docs:lint: no such page: ${missing.map((p) => `docs/${p}`).join(', ')}`);
        return 2;
    }
    const problems = lintPages(site, paths);
    if (!problems.length) {
        console.log(`docs:lint: ${paths.length} page${paths.length === 1 ? '' : 's'} ok`);
        return 0;
    }
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\ndocs:lint: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
    return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
