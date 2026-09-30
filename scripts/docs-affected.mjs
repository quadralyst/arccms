#!/usr/bin/env node
/**
 * `npm run docs:affected`: the docs pages that describe the files you changed.
 *
 * Every page names the code it describes in <meta name="docs:sources">. This compares
 * your working copy (committed or not, and new files) with a base (default `dev`) and
 * lists the pages whose sources overlap the changed files, so you know which pages to
 * read and update in the same task. Screenshots of those pages need a look too.
 *
 *   npm run docs:affected                  changes since dev
 *   npm run docs:affected -- --base main   changes since another base
 *
 * It only reports: exit code 0. A page you have already edited is marked so.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { affectedPages, loadSite, REPO_ROOT } from './docs-lib.mjs';

const git = (args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Files changed against a base: committed since the merge base, edited, staged, or new. */
export function changedFiles(base) {
    let ref = base;
    try {
        git(['rev-parse', '--verify', '--quiet', base]);
    } catch {
        ref = 'HEAD';
    }
    const changed = new Set(git(['diff', '--name-only', ref]).split('\n').filter(Boolean));
    for (const file of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) changed.add(file);
    return { files: [...changed].sort(), base: ref };
}

export function main(argv = process.argv.slice(2)) {
    const at = argv.indexOf('--base');
    const base = at >= 0 && argv[at + 1] ? argv[at + 1] : 'dev';
    const { files, base: used } = changedFiles(base);
    const site = loadSite();
    const pages = affectedPages(site, files);
    if (used !== base) console.log(`docs:affected: "${base}" was not found, comparing with HEAD`);
    console.log(`docs:affected: ${files.length} changed file${files.length === 1 ? '' : 's'} against ${used}`);
    if (!pages.length) {
        console.log('No docs page names these files as its sources. If the change is visible to a developer or an admin, a page may still need a line: check the section it belongs to.');
        return 0;
    }
    console.log('\nRead these pages and update what is now wrong (and retake their screenshots):\n');
    for (const page of pages) {
        console.log(`  docs/${page.path}${page.edited ? '   (edited already)' : ''}`);
        for (const file of page.files.slice(0, 6)) console.log(`      ${file}`);
        if (page.files.length > 6) console.log(`      and ${page.files.length - 6} more`);
    }
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
