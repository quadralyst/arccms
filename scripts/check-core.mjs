#!/usr/bin/env node
/**
 * `npm run check:core`: in an app built on a copy of Arc CMS, list the Arc CMS
 * (core) files the app has changed (docs/custom-code.md).
 *
 * An app keeps its own code in the custom space (src/custom, functions/src/custom,
 * the *.app.rules files) and never edits core files, so pulling Arc CMS updates
 * merges cleanly. This compares the working copy, committed or not, with the
 * Arc CMS version it is based on (the `upstream` remote), and sorts every
 * difference into:
 *
 *   custom    the app's own files: fine
 *   install   this install's settings (Firebase config): fine
 *   review    dependency lists: fine to change, worth a look
 *   core      Arc CMS files: move the change into the custom space, or build
 *             it in Arc CMS itself and pull it
 *
 * Exit code 1 when a core file changed, or when there is no Arc CMS version to
 * compare with (so the check never passes without checking); 0 otherwise, and in
 * Arc CMS itself (its own repository has no upstream).
 *
 *   npm run check:core                     compares with upstream/main
 *   npm run check:core -- --against upstream/dev
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_UPSTREAM = 'upstream/main';
export const ARC_CMS_REPO = 'git@github.com:quadralyst/arccms.git';

const CUSTOM = [
    /^src\/custom\//,
    /^functions\/src\/custom\//,
    /^firestore\.app\.rules$/,
    /^storage\.app\.rules$/,
    /^firestore\.app\.indexes\.json$/,
    /^tests\/rules\/custom\//,
    /^docs\/custom\//,
];

const INSTALL = [
    /^src\/environments\/environment(\.prod)?\.ts$/,
    /^src\/environments\/arc-install\.ts$/,
];

const REVIEW = [
    /^package(-lock)?\.json$/,
    /^functions\/package(-lock)?\.json$/,
];

/** Which kind of file this is (see the header). */
export function classify(path) {
    if (CUSTOM.some((re) => re.test(path))) return 'custom';
    if (INSTALL.some((re) => re.test(path))) return 'install';
    if (REVIEW.some((re) => re.test(path))) return 'review';
    return 'core';
}

/** Changed paths grouped by kind. */
export function group(paths) {
    const groups = { custom: [], install: [], review: [], core: [] };
    for (const path of [...new Set(paths)].sort()) groups[classify(path)].push(path);
    return groups;
}

function git(args, cwd) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function lines(text) {
    return text ? text.split('\n').filter(Boolean) : [];
}

/**
 * Every path that differs from `against`: committed, staged, unstaged and new
 * files. `--no-renames`, or a core file moved into the custom space would be
 * listed only under its new, custom path (review F).
 */
export function changedPaths(against, cwd = process.cwd()) {
    const base = git(['merge-base', 'HEAD', against], cwd);
    return [
        ...lines(git(['diff', '--name-only', '--no-renames', base], cwd)),
        ...lines(git(['ls-files', '--others', '--exclude-standard'], cwd)),
    ];
}

/** Whether this checkout is Arc CMS itself: a remote points at its repository. */
export function isArcCmsItself(cwd) {
    try {
        return /[/:]quadralyst\/arccms(\.git)?$/m.test(git(['remote', '-v'], cwd).replace(/ \((fetch|push)\)/g, ''));
    } catch {
        return false;
    }
}

function hasRef(ref, cwd) {
    try {
        git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
        return true;
    } catch {
        return false;
    }
}

export function main(argv = process.argv.slice(2), log = console.log, cwd = process.cwd()) {
    const i = argv.indexOf('--against');
    const against = i === -1 ? DEFAULT_UPSTREAM : argv[i + 1];

    if (!hasRef(against, cwd)) {
        if (isArcCmsItself(cwd)) {
            log('This is Arc CMS itself: there is no core to protect, so nothing to check.');
            return 0;
        }
        // Passing here would let an app edit core files with the check still green.
        log(`No ${against} to compare with, so nothing was checked. Add Arc CMS as the upstream remote once:`);
        log(`  git remote add upstream ${ARC_CMS_REPO}`);
        log('  git fetch upstream');
        return 1;
    }

    const groups = group(changedPaths(against, cwd));
    if (groups.review.length) {
        log(`Dependency lists changed (fine, worth a look before the next Arc CMS update):\n  ${groups.review.join('\n  ')}`);
    }
    if (!groups.core.length) {
        log(`No Arc CMS core file changed compared with ${against}. ${groups.custom.length} custom and ${groups.install.length} install file(s) differ.`);
        return 0;
    }
    log(`These Arc CMS core files changed compared with ${against}:\n  ${groups.core.join('\n  ')}`);
    log('Move each change into the custom space (src/custom, functions/src/custom, *.app.rules),');
    log('or build it in Arc CMS as a general feature and pull it. See docs/custom-code.md.');
    return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main();
}
