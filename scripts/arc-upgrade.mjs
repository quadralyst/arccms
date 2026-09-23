/**
 * npm run arc:upgrade -- --project=<alias or id> [--dry-run] [--no-legacy]
 *
 * One-time move of an existing install to the arccms- function names
 * (docs/coexistence-spec.md, CO4, section 4.1).
 *
 * Old and new names cannot overlap: two copies of every trigger would send every
 * welcome email, drip step and notification twice. So this deletes the old
 * ArcCMS functions first, then deploys the arccms codebase, then the
 * arccms-legacy proxies that keep old URLs working. Expect a few minutes in
 * which Firestore events are not handled; run it at a quiet time.
 *
 * Only functions whose names ArcCMS exports AND that are not already in the
 * arccms codebase are deleted, so another app's functions in the same project
 * are never touched, even if they happen to live in the `default` codebase.
 *
 * Hosting is NOT deployed. Deploy it straight afterwards: the previous frontend
 * calls the old callable names, which no longer exist once this has run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NEW_CODEBASE = 'arccms';
const LEGACY_CODEBASE = 'arccms-legacy';

/** Codebase label of a deployed function, as `firebase functions:list --json` reports it. */
export function codebaseOf(fn) {
    return fn.codebase || fn.labels?.['firebase-functions-codebase'] || 'default';
}

/**
 * What to delete: deployed functions with an ArcCMS name that are not already
 * in the arccms (or arccms-legacy) codebase, grouped by region.
 */
export function planUpgrade(deployed, arcNames) {
    const names = new Set(arcNames);
    const byRegion = {};
    for (const fn of deployed) {
        const codebase = codebaseOf(fn);
        if (codebase === NEW_CODEBASE || codebase === LEGACY_CODEBASE) continue;
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

/** The function names ArcCMS exports, read from the built functions. */
async function arcFunctionNames() {
    run('npm', ['run', 'build', '--prefix', 'functions']);
    const entry = pathToFileURL(resolve(ROOT, 'functions/lib/index.js')).href;
    const { arccms } = await import(entry);
    return Object.entries(arccms).filter(([, v]) => v && v.__endpoint).map(([k]) => k);
}

function parseArgs(argv) {
    const opts = { dryRun: false, legacy: true, project: '' };
    for (const arg of argv) {
        if (arg === '--dry-run') opts.dryRun = true;
        else if (arg === '--no-legacy') opts.legacy = false;
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
    console.log(`Then deploy the "${NEW_CODEBASE}" codebase${opts.legacy ? ` and the "${LEGACY_CODEBASE}" proxies` : ''}.`);
    if (opts.dryRun) {
        console.log('\nDry run: nothing changed.');
        return 0;
    }

    for (const [region, ids] of Object.entries(plan.byRegion)) {
        run('firebase', ['functions:delete', ...ids, '--region', region, '--project', opts.project, '--force']);
    }
    // --force: first creation of functions with a retry policy needs it when non-interactive.
    // It only manages the codebases in the config, so nothing outside ArcCMS is affected.
    run('node', ['scripts/arc-deploy.mjs', '--only', 'functions', '--project', opts.project, '--non-interactive', '--force']);

    if (opts.legacy) {
        if (!existsSync(resolve(ROOT, 'functions-legacy/node_modules'))) run('npm', ['install', '--prefix', 'functions-legacy']);
        run('firebase', ['deploy', '--config', 'firebase.legacy.json', '--only', 'functions', '--project', opts.project, '--non-interactive', '--force']);
    }

    console.log(`
Done. Next, straight away:
  1. Deploy hosting. The previous frontend calls the old callable names, which no
     longer exist.
  2. Re-register webhooks at the new URLs when convenient (the legacy proxies
     cover the old ones until then): arccms-dodoWebhook, arccms-handleEmailWebhook.
  3. Republish static pages at leisure; old ones reach search through the proxy.
  4. Send one test email and make one test checkout.`);
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().then((code) => { process.exitCode = code; }, (err) => {
        console.error(`error: ${err.message}`);
        process.exitCode = 1;
    });
}
