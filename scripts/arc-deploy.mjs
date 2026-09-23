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
 * - after a deploy that included functions, runs the callable access check. A
 *   callable whose creation timed out is left without public access, and every
 *   browser call to it then fails with 403 (found 2026-09-23). Pass --no-probe
 *   to skip it.
 *
 *   node scripts/arc-deploy.mjs --only functions --project default
 */
import { spawnSync } from 'node:child_process';
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

function run(cmd, args) {
    const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const projectId = resolveProjectId(projectArg(args), readFirebaseAliases());
    const firebaseArgs = deployArgs(args, !!projectId && existsSync(generatedConfigPath(projectId)), projectId);
    console.log(`> firebase ${firebaseArgs.join(' ')}`);
    let status = run('firebase', firebaseArgs);

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
