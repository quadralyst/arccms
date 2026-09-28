#!/usr/bin/env node
/**
 * `firebase deploy` for this install (docs/coexistence-spec.md, CO-D14, CO3.2).
 *
 * Passes every argument through to `firebase deploy`, and:
 *
 * - adds `--config firebase.<projectId>.json` when `npm run arc:configure`
 *   generated one for the target project, so a project set up with a named
 *   database, its own bucket or its own hosting site deploys those. Without that
 *   file this is plain `firebase deploy` against firebase.json;
 * - builds the functions (`tsc`) before a deploy that includes them. The CLI
 *   uploads functions/lib as it is, so without this a deploy ships the last
 *   build and new functions are silently missing (found 2026-09-24);
 * - retries the functions the CLI started creating or updating but never
 *   reported success for. A deploy of many functions hits Google's per-minute
 *   limit on changes (HTTP 429), and the CLI gives up on a few after its own
 *   retries (found 2026-09-28). The wrapper waits for the limit to reset and
 *   deploys just those, up to RETRY_ROUNDS times;
 * - fails a functions deploy in which a function still never reported success
 *   after that. The CLI can exit 0 after a rate limit quietly skipped an
 *   update, leaving the old code live (found 2026-09-24);
 * - with --probe, after a deploy that included functions, runs the callable
 *   access check. A callable whose creation timed out is left without public
 *   access, and every browser call to it then fails with 403 (found 2026-09-23).
 *   Off by default since 2026-09-28: it calls every callable one by one, which
 *   made even a one-function deploy slow. Only a newly created callable can
 *   lose its access; run it after a deploy that adds one, and before a release.
 *
 *   node scripts/arc-deploy.mjs --only functions --project default
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readFirebaseAliases, resolveProjectId } from './arc-install-config.mjs';

/** Retry rounds for functions that never reported success, and the wait before each. */
export const RETRY_ROUNDS = 2;
export const RETRY_WAIT_MS = 65_000;

/** The generated Firebase CLI config for a project. */
export function generatedConfigPath(projectId) {
    return resolve(ROOT, `firebase.${projectId}.json`);
}

/** The `--project` / `-P` value in firebase arguments, or '' when absent. */
export function projectArg(args) {
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--project=')) return arg.slice('--project='.length);
        if ((arg === '--project' || arg === '-P') && args[i + 1]) return args[i + 1];
    }
    return '';
}

/** Whether a deploy names hosting in --only (a plain deploy has no hosting target to check). */
export function namesHosting(args) {
    const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
    if (i === -1) return false;
    const only = args[i].startsWith('--only=') ? args[i].slice('--only='.length) : args[i + 1] || '';
    return only.split(',').some((target) => target.trim().split(':')[0] === 'hosting');
}

/** Whether a deploy with these arguments deploys functions. */
export function deploysFunctions(args) {
    const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
    if (i === -1) return true;
    const only = args[i].startsWith('--only=') ? args[i].slice('--only='.length) : args[i + 1] || '';
    return only.split(',').some((target) => target.trim().startsWith('functions'));
}

/**
 * Whether a deploy deploys functions and nothing else. Only then can a clean
 * retry clear the first run's failure: in a mixed deploy the failure may have
 * come from rules or hosting, which the retry does not touch.
 */
export function deploysOnlyFunctions(args) {
    const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
    if (i === -1) return false;
    const only = args[i].startsWith('--only=') ? args[i].slice('--only='.length) : args[i + 1] || '';
    const targets = only.split(',').map((t) => t.trim()).filter(Boolean);
    return targets.length > 0 && targets.every((t) => t.startsWith('functions'));
}

/**
 * The `firebase` arguments for a deploy. An explicit --config/-c wins; otherwise
 * the target project's generated config is added when it exists.
 */
export function deployArgs(args, generatedExists, projectId, cwd = process.cwd()) {
    const passthrough = args.filter((a) => a !== '--no-probe' && a !== '--probe');
    const hasConfig = passthrough.some((a) => a === '--config' || a === '-c' || a.startsWith('--config='));
    if (hasConfig || !generatedExists || !projectId) return ['deploy', ...passthrough];
    const config = generatedConfigPath(projectId);
    return ['deploy', '--config', relative(cwd, config) || config, ...passthrough];
}

/**
 * Functions the CLI started working on but never reported success for, from its
 * output. Lines look like
 *   `i  functions: updating Node.js 22 (2nd Gen) function arccms:arccms-search(us-central1)...`
 *   `✔  functions[arccms:arccms-search(us-central1)] Successful update operation.`
 */
export function unconfirmedFunctions(output) {
    return unconfirmed(output).map((fn) => `${fn.name}(${fn.region})`);
}

/**
 * The same, with each function's codebase and whether it was a delete. Colour
 * codes are stripped first, so the patterns hold when the CLI writes colour.
 */
export function unconfirmed(output) {
    const started = new Map();
    const confirmed = new Set();
    for (const line of output.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
        const start = /\b(creating|updating|deleting) .*? function (?:([\w-]+):)?([\w-]+)\(([\w-]+)\)\.\.\./.exec(line);
        if (start) {
            started.set(`${start[3]}(${start[4]})`, {
                codebase: start[2] || '', name: start[3], region: start[4], deleting: start[1] === 'deleting',
            });
        }
        const done = /functions\[(?:[\w-]+:)?([\w-]+)\(([\w-]+)\)\] Successful (?:create|update|delete) operation/.exec(line);
        if (done) confirmed.add(`${done[1]}(${done[2]})`);
    }
    return [...started.entries()]
        .filter(([key]) => !confirmed.has(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, fn]) => fn);
}

/**
 * The `--only` targets that redeploy these functions. A grouped function's id
 * joins its groups with `-` (`arccms-search`); the CLI selects it as
 * `functions:<codebase>:arccms.search`. Deletes are left out: a redeploy
 * cannot finish a delete, so those are reported instead.
 */
export function retryTargets(functions) {
    return functions
        .filter((fn) => !fn.deleting)
        .map((fn) => `functions:${fn.codebase ? `${fn.codebase}:` : ''}${fn.name.split('-').join('.')}`);
}

/** The deploy arguments with `--only` replaced by these targets. */
export function retryArgs(firebaseArgs, targets) {
    const out = [];
    for (let i = 0; i < firebaseArgs.length; i++) {
        const arg = firebaseArgs[i];
        if (arg === '--only') { i++; continue; }
        if (arg.startsWith('--only=')) continue;
        out.push(arg);
    }
    return [...out, '--only', targets.join(',')];
}

/** Runs a command with its output streamed live and also collected. */
function run(cmd, args) {
    return new Promise((resolvePromise) => {
        const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
        let output = '';
        child.stdout.on('data', (chunk) => { process.stdout.write(chunk); output += chunk; });
        child.stderr.on('data', (chunk) => { process.stderr.write(chunk); output += chunk; });
        child.on('close', (code) => resolvePromise({ status: code ?? 1, output }));
        child.on('error', (err) => resolvePromise({ status: 1, output: String(err) }));
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const projectId = resolveProjectId(projectArg(args), readFirebaseAliases());
    const generated = !!projectId && existsSync(generatedConfigPath(projectId));
    const firebaseArgs = deployArgs(args, generated, projectId);
    // Hosting off (arc:configure --site=none) leaves no hosting in the generated
    // config, so say that plainly rather than pass on the CLI's error (review O2).
    if (generated && namesHosting(args) && !JSON.parse(readFileSync(generatedConfigPath(projectId), 'utf8')).hosting) {
        console.error(`Hosting is off for ${projectId} (arc:configure --site=none): there is no website to deploy here.`);
        process.exit(1);
    }
    if (deploysFunctions(args)) {
        console.log('> npm run build --prefix functions');
        const build = spawnSync('npm', ['run', 'build', '--prefix', resolve(ROOT, 'functions')], {
            stdio: 'inherit', shell: process.platform === 'win32',
        });
        if (build.status !== 0) {
            console.error('\nThe functions build failed, so nothing was deployed.');
            process.exit(build.status ?? 1);
        }
    }
    console.log(`> firebase ${firebaseArgs.join(' ')}`);
    const deploy = await run('firebase', firebaseArgs);
    let status = deploy.status;

    let missing = unconfirmed(deploy.output);
    for (let round = 1; round <= RETRY_ROUNDS && retryTargets(missing).length; round++) {
        const targets = retryTargets(missing);
        const deletes = missing.filter((fn) => fn.deleting);
        console.log(`\n${targets.length} function(s) never reported success, likely Google's per-minute limit on changes. `
            + `Waiting ${Math.round(RETRY_WAIT_MS / 1000)} seconds, then deploying just those (retry ${round} of ${RETRY_ROUNDS}).`);
        await new Promise((done) => setTimeout(done, RETRY_WAIT_MS));
        const again = retryArgs(firebaseArgs, targets);
        console.log(`> firebase ${again.join(' ')}`);
        const retry = await run('firebase', again);
        missing = [...deletes, ...unconfirmed(retry.output)];
        if (retry.status === 0 && !missing.length && (status === 0 || deploysOnlyFunctions(args))) status = 0;
    }
    if (missing.length) {
        const names = missing.map((fn) => `${fn.name}(${fn.region})${fn.deleting ? ', a delete' : ''}`);
        console.error(`\nThese functions were started but never reported success, so the old version may still be live:\n  ${names.join('\n  ')}\nRedeploy them: npm run deploy -- --only ${retryTargets(missing).join(',') || 'functions:<codebase>:<group>.<name>'}`);
        status = status || 1;
    }

    if (status === 0 && projectId && deploysFunctions(args) && args.includes('--probe')) {
        console.log(`\n> Checking that every callable is publicly invocable on ${projectId}`);
        const probe = spawnSync('bash', [resolve(ROOT, 'functions/scripts/check-callable-access.sh')], {
            stdio: 'inherit',
            env: { ...process.env, FIREBASE_PROJECT: projectId },
        });
        if (probe.status !== 0) {
            console.error('\nSome callables are blocked. Delete and redeploy them (a fresh create grants access).');
            status = probe.status ?? 1;
        }
    }
    process.exitCode = status;
}
