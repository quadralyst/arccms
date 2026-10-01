#!/usr/bin/env node
/**
 * `npm run check:core`: in an app built on a copy of Arc CMS, list the Arc CMS
 * (core) files the app has changed (docs/app/custom-space.html).
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
 *   npm run check:core                     compares with upstream/main or
 *                                          upstream/dev, whichever the app follows
 *   npm run check:core -- --against upstream/dev
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The Arc CMS branches an app can follow; on a tie the first wins. */
export const UPSTREAM_BRANCHES = ['upstream/main', 'upstream/dev'];
export const ARC_CMS_REPO = 'git@github.com:quadralyst/arccms.git';

const CUSTOM = [
    /^src\/custom\//,
    /^functions\/src\/custom\//,
    /^firestore\.app\.rules$/,
    /^storage\.app\.rules$/,
    /^firestore\.app\.indexes\.json$/,
    /^tests\/rules\/custom\//,
    /^docs\/custom\//,
    /^custom\//,
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

/** Whether a remote points at Arc CMS's repository (in an app, `upstream` does too). */
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

/**
 * Whether this checkout is Arc CMS's own repository rather than an app built on it:
 * a remote points at Arc CMS, and there is no upstream Arc CMS branch to follow.
 * Core tests that only hold in Arc CMS itself (the starter files ship empty) skip
 * anywhere else with this.
 */
export function isArcCmsRepository(cwd = process.cwd()) {
    return isArcCmsItself(cwd) && !UPSTREAM_BRANCHES.some((ref) => hasRef(ref, cwd));
}

/**
 * The Arc CMS branch this copy follows: of the upstream branches that exist, the
 * one HEAD has the fewest commits beyond, since that is the one the app was copied
 * from or last merged. A copy taken from dev then needs no --against. Null when
 * no upstream branch exists.
 */
export function followedUpstream(cwd, branches = UPSTREAM_BRANCHES) {
    let best = null;
    for (const ref of branches) {
        if (!hasRef(ref, cwd)) continue;
        let ahead;
        try {
            ahead = Number(git(['rev-list', '--count', `${git(['merge-base', 'HEAD', ref], cwd)}..HEAD`], cwd));
        } catch {
            continue; // no history in common
        }
        if (!best || ahead < best.ahead) best = { ref, ahead };
    }
    return best?.ref ?? null;
}

export function main(argv = process.argv.slice(2), log = console.log, cwd = process.cwd()) {
    const i = argv.indexOf('--against');
    const against = i === -1 ? followedUpstream(cwd) : argv[i + 1];

    if (!against || !hasRef(against, cwd)) {
        if (isArcCmsRepository(cwd)) {
            log('This is Arc CMS itself: there is no core to protect, so nothing to check.');
            return 0;
        }
        // Passing here would let an app edit core files with the check still green.
        log(`No ${against ?? UPSTREAM_BRANCHES.join(' or ')} to compare with, so nothing was checked. Add Arc CMS as the upstream remote once:`);
        log(`  git remote add upstream ${ARC_CMS_REPO}`);
        log('  git fetch upstream');
        return 1;
    }

    if (i === -1) log(`Comparing with ${against}, the Arc CMS branch this copy follows (choose another with --against).`);
    const groups = group(changedPaths(against, cwd));
    if (groups.review.length) {
        log(`Dependency lists changed (fine, worth a look before the next Arc CMS update):\n  ${groups.review.join('\n  ')}`);
    }
    if (!groups.core.length) {
        log(`No Arc CMS core file changed compared with ${against}. ${groups.custom.length} custom and ${groups.install.length} install file(s) differ.`);
        return 0;
    }
    log(`These Arc CMS core files changed compared with ${against}:\n  ${groups.core.join('\n  ')}`);
    log('Move each change into the custom space (src/custom, functions/src/custom, custom, *.app.rules),');
    log('or build it in Arc CMS as a general feature and pull it. See docs/app/custom-space.html.');
    return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main();
}
