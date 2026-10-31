#!/usr/bin/env node
/**
 * `npm run build`: builds the website and numbers the build (docs/app/version.html,
 * specs/app-version-spec.md AV-D2 to AV-D5).
 *
 *   npm run build                       the next build number
 *   npm run build -- --no-bump          no number, custom/package.json left alone (or ARC_NO_BUMP=1)
 *   npm run build -- --label=android    this build's label in place of "buildLabel" (or ARC_BUILD_LABEL)
 *
 * With a version in custom/package.json, the build takes the next number (one more than
 * "build"), hands it to Vite as VITE_ARC_BUILD, and writes it back to custom/package.json
 * once the build has succeeded; a failed build leaves the file as it was. Without one,
 * the site is built with no version, as Arc CMS itself is.
 *
 * The build gets an 8 GB heap; a NODE_OPTIONS the caller sets still wins, since Node takes
 * the last --max-old-space-size (specs/build-memory.md). The post-build step copies
 * dist/client/index.html to __shell.html, the page firebase.json serves for every route.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './arc-install-config.mjs';
import { APP_PACKAGE, checkLabel, nextBuild, readAppPackage, versionOf, versionText, withBuild } from './arc-version.mjs';

/** The heap the build gets: 8 GB, then whatever NODE_OPTIONS already says, which wins. */
export function buildNodeOptions(env = process.env) {
    return `--max-old-space-size=8192 ${env.NODE_OPTIONS ?? ''}`.trim();
}

/**
 * `--no-bump` and `--label=<text>` from the arguments, then ARC_NO_BUMP and ARC_BUILD_LABEL.
 * Typed without the `--` (`npm run build --no-bump`), npm keeps them as its own settings,
 * npm_config_bump ('' for --no-bump) and npm_config_label, so those count too. Anything
 * else stops here.
 */
export function buildOptions(argv, env = process.env) {
    let bump = !['1', 'true'].includes(String(env.ARC_NO_BUMP ?? '').toLowerCase())
        && !['', 'false'].includes(env.npm_config_bump ?? 'unset');
    let label = env.ARC_BUILD_LABEL ?? env.npm_config_label;
    for (const arg of argv) {
        if (arg === '--no-bump') bump = false;
        else if (arg.startsWith('--label=')) label = arg.slice('--label='.length);
        else throw new Error(`npm run build does not know ${arg}. It takes --no-bump and --label=<text> (docs/app/version.html).`);
    }
    return { bump, label };
}

/**
 * What this build is: its number (null for none), its label, the text it shows, and the
 * environment Vite runs with. Every problem with custom/package.json or the label stops
 * here, before anything is built.
 */
export function planBuild({ root = ROOT, argv = [], env = process.env } = {}) {
    const options = buildOptions(argv, env);
    const found = readAppPackage(root);
    const version = versionOf(found?.pkg);
    const label = options.label !== undefined
        ? checkLabel(options.label)
        : checkLabel(found?.pkg.buildLabel, `${APP_PACKAGE}: "buildLabel"`);
    const next = version && options.bump ? nextBuild(found.pkg) : { build: null, warning: '' };
    // Never a number left in the shell: this build's, or none.
    const { VITE_ARC_BUILD: _stale, ARC_NO_BUMP: _skip, ...rest } = env;
    const viteEnv = { ...rest, NODE_OPTIONS: buildNodeOptions(env), ARC_BUILD_LABEL: label };
    if (next.build !== null) viteEnv.VITE_ARC_BUILD = String(next.build);
    return {
        build: next.build, label, warning: next.warning, found,
        text: versionText({ version, build: next.build, label }), env: viteEnv,
    };
}

/** Vite's own command-line script, run with this Node. */
function viteBin() {
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
}

/** Builds the website (see the top of this file); the exit status. */
export function runWebsiteBuild({ root = ROOT, argv = [], env = process.env, run = spawnSync, log = console.log } = {}) {
    let plan;
    try {
        plan = planBuild({ root, argv, env });
    } catch (error) {
        console.error(`${error.message}\nNothing was built.`);
        return 1;
    }
    if (plan.warning) console.warn(plan.warning);
    if (plan.text) log(`> Building ${plan.text}${plan.build === null ? ' (no build number)' : ''}`);
    const vite = run(process.execPath, [viteBin(), 'build'], { cwd: root, stdio: 'inherit', env: plan.env });
    if (vite.status !== 0) {
        if (plan.build !== null) log(`\nThe build failed, so ${APP_PACKAGE} still says "build": ${plan.found.pkg.build ?? 'nothing'}.`);
        return vite.status ?? 1;
    }
    copyFileSync(resolve(root, 'dist/client/index.html'), resolve(root, 'dist/analog/public/__shell.html'));
    if (plan.build !== null) {
        // Read again: the file may have been edited while the build ran.
        try {
            const now = readAppPackage(root) ?? plan.found;
            writeFileSync(now.path, withBuild(now.text, plan.build));
        } catch (error) {
            console.error(`\nThe site is built as ${plan.text}, but ${APP_PACKAGE} could not be updated: ${error.message}\nSet "build" to ${plan.build} by hand.`);
            return 1;
        }
        log(`\nThis is build ${plan.text}. ${APP_PACKAGE} now says "build": ${plan.build}: commit it with your next change.`);
    }
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = runWebsiteBuild({ argv: process.argv.slice(2) });
}
