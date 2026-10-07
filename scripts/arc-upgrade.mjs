/**
 * npm run arc:upgrade -- --project=<alias or id> [--dry-run]
 *
 * One-time move of an existing install to the arccms- function names
 * (specs/coexistence-spec.md, CO4, section 4.1).
 *
 * Old and new names cannot overlap: two copies of every trigger would send every
 * welcome email, drip step and notification twice. So this deletes the old
 * ArcCMS functions first, then deploys the arccms codebase. Expect a few
 * minutes in which Firestore events are not handled; run it at a quiet time.
 *
 * Old URLs stop working: open-tracking pixels and links in emails already sent,
 * webhook URLs registered with Dodo and the email provider, and the search
 * endpoint in static pages published before the upgrade. Re-register the
 * webhooks and republish pages afterwards (specs/coexistence-spec.md, CO-D6).
 *
 * Only functions whose names ArcCMS exports AND that are not already in the
 * arccms codebase are deleted, so another app's functions in the same project
 * are never touched, even if they happen to live in the `default` codebase.
 *
 * Hosting is NOT deployed. Deploy it straight afterwards: the previous frontend
 * calls the old callable names, which no longer exist once this has run.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtArccms, isCloudFunction } from './arc-built-functions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NEW_CODEBASE = 'arccms';

/**
 * ArcCMS functions removed from the code since installs started upgrading, whose
 * old-name copies must still be deleted: the search triggers that fired on every
 * write (specs/feature-flags-spec.md 6.5).
 */
export const RETIRED_FUNCTIONS = ['onAnyDocumentWritten', 'onTranslationWritten'];

/** Codebase label of a deployed function, as `firebase functions:list --json` reports it. */
export function codebaseOf(fn) {
    return fn.codebase || fn.labels?.['firebase-functions-codebase'] || 'default';
}

/**
 * What to delete: deployed functions with an ArcCMS name that are not already
 * in the arccms codebase, grouped by region.
 */
export function planUpgrade(deployed, arcNames) {
    const names = new Set(arcNames);
    const byRegion = {};
    for (const fn of deployed) {
        const codebase = codebaseOf(fn);
        if (codebase === NEW_CODEBASE) continue;
        if (!names.has(fn.id)) continue;
        (byRegion[fn.region] ??= []).push(fn.id);
    }
    for (const ids of Object.values(byRegion)) ids.sort();
    const count = Object.values(byRegion).reduce((n, ids) => n + ids.length, 0);
    return { byRegion, count };
}

function run(cmd, args, { capture = false, cwd = ROOT } = {}) {
    const result = spawnSync(cmd, args, {
        cwd,
        stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
        encoding: 'utf8',
        shell: process.platform === 'win32',
    });
    if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${result.status})`);
    return result.stdout;
}

/**
 * Every function name ArcCMS has, read from the built functions: the exported
 * ones and those of features this app turned off (specs/feature-flags-spec.md),
 * whose old-name copies must go too although nothing replaces them.
 */
async function arcFunctionNames() {
    run('npm', ['run', 'build', '--prefix', 'functions']);
    const lib = resolve(ROOT, 'functions/lib');
    const modules = [await builtArccms()];
    for (const file of readdirSync(resolve(lib, 'features')).filter((f) => f.endsWith('.js'))) {
        modules.push(await import(pathToFileURL(resolve(lib, 'features', file)).href));
    }
    return [...new Set([...exportedFunctionNames(modules), ...RETIRED_FUNCTIONS])];
}

/** The names of the functions the given build modules export, top level only. */
export function exportedFunctionNames(modules) {
    return modules.flatMap((m) => Object.entries(m ?? {}).filter(([, v]) => isCloudFunction(v)).map(([k]) => k));
}

function parseArgs(argv) {
    const opts = { dryRun: false, project: '' };
    for (const arg of argv) {
        if (arg === '--dry-run') opts.dryRun = true;
        else if (arg.startsWith('--project=')) opts.project = arg.slice('--project='.length);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!opts.project) throw new Error('Pass --project=<alias or project id>.');
    return opts;
}

export async function main(argv = process.argv.slice(2)) {
    const opts = parseArgs(argv);
    const names = await arcFunctionNames();
    const listed = JSON.parse(run('firebase', ['functions:list', '--project', opts.project, '--json'], { capture: true }));
    const deployed = listed.result ?? listed;
    const plan = planUpgrade(deployed, names);

    console.log(`\nArcCMS exports ${names.length} functions.`);
    if (plan.count === 0) {
        console.log('No old-name ArcCMS functions are deployed; nothing to delete.');
    } else {
        console.log(`Old-name ArcCMS functions to delete (${plan.count}):`);
        for (const [region, ids] of Object.entries(plan.byRegion)) console.log(`  ${region}: ${ids.join(' ')}`);
    }
    console.log(`Then deploy the "${NEW_CODEBASE}" codebase.`);
    if (opts.dryRun) {
        console.log('\nDry run: nothing changed.');
        return 0;
    }

    for (const [region, ids] of Object.entries(plan.byRegion)) {
        run('firebase', ['functions:delete', ...ids, '--region', region, '--project', opts.project, '--force']);
    }
    // --force: first creation of functions with a retry policy needs it when non-interactive,
    // and it accepts the deletions arc-deploy lists. It only manages the codebases in the
    // config, so nothing outside ArcCMS is affected.
    run('node', ['scripts/arc-deploy.mjs', '--only', 'functions', '--project', opts.project, '--non-interactive', '--force']);

    console.log(`
Done. Next, straight away:
  1. Deploy hosting. The previous frontend calls the old callable names, which no
     longer exist.
  2. Re-register webhooks at the new URLs: arccms-dodoWebhook and
     arccms-handleEmailWebhook. Until then, provider events are lost.
  3. Republish static pages, so their search box calls arccms-search.
  4. Send one test email and make one test checkout.`);
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().then((code) => { process.exitCode = code; }, (err) => {
        console.error(`error: ${err.message}`);
        process.exitCode = 1;
    });
}
