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
 * - fails a functions deploy in which a function the CLI started creating,
 *   updating or deleting never reported success. The CLI can exit 0 after a
 *   rate limit (HTTP 429) quietly skipped an update, leaving the old code live
 *   (found 2026-09-24);
 * - after a deploy that included functions, runs the callable access check. A
 *   callable whose creation timed out is left without public access, and every
 *   browser call to it then fails with 403 (found 2026-09-23). Pass --no-probe
 *   to skip it.
 *
 *   node scripts/arc-deploy.mjs --only functions --project default
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readFirebaseAliases, resolveProjectId } from './arc-install-config.mjs';

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

/** Whether a deploy with these arguments deploys functions. */
export function deploysFunctions(args) {
    const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
    if (i === -1) return true;
    const only = args[i].startsWith('--only=') ? args[i].slice('--only='.length) : args[i + 1] || '';
    return only.split(',').some((target) => target.trim().startsWith('functions'));
}

/**
 * The `firebase` arguments for a deploy. An explicit --config/-c wins; otherwise
 * the target project's generated config is added when it exists.
 */
export function deployArgs(args, generatedExists, projectId, cwd = process.cwd()) {
    const passthrough = args.filter((a) => a !== '--no-probe');
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
    const started = new Set();
    const confirmed = new Set();
    for (const line of output.split('\n')) {
        const start = /\b(?:creating|updating|deleting) .*? function (?:[\w-]+:)?([\w-]+)\(([\w-]+)\)\.\.\./.exec(line);
        if (start) started.add(`${start[1]}(${start[2]})`);
        const done = /functions\[(?:[\w-]+:)?([\w-]+)\(([\w-]+)\)\] Successful (?:create|update|delete) operation/.exec(line);
        if (done) confirmed.add(`${done[1]}(${done[2]})`);
    }
    return [...started].filter((fn) => !confirmed.has(fn)).sort();
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
    const firebaseArgs = deployArgs(args, !!projectId && existsSync(generatedConfigPath(projectId)), projectId);
    console.log(`> firebase ${firebaseArgs.join(' ')}`);
    const deploy = await run('firebase', firebaseArgs);
    let status = deploy.status;

    const missing = unconfirmedFunctions(deploy.output);
    if (missing.length) {
        console.error(`\nThese functions were started but never reported success, so the old version may still be live:\n  ${missing.join('\n  ')}\nRedeploy them, for example: npm run deploy -- --only functions:<codebase>:<group>.<name>`);
        status = status || 1;
    }

    if (status === 0 && projectId && deploysFunctions(args) && !args.includes('--no-probe')) {
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
