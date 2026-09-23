#!/usr/bin/env node
/**
 * `firebase deploy` for this install (docs/coexistence-spec.md, CO-D14).
 *
 * Passes every argument through to `firebase deploy`, adding
 * `--config firebase.arccms.json` when `npm run arc:configure` generated one, so
 * a shared-project install deploys its own database rules, indexes, bucket and
 * hosting site. Without that file this is plain `firebase deploy`.
 *
 *   node scripts/arc-deploy.mjs --only functions
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GENERATED_CONFIG = resolve(ROOT, 'firebase.arccms.json');

/** The `firebase` arguments for a deploy. An explicit --config/-c wins. */
export function deployArgs(args, generatedExists, cwd = process.cwd()) {
    const hasConfig = args.some((a) => a === '--config' || a === '-c' || a.startsWith('--config='));
    if (hasConfig || !generatedExists) return ['deploy', ...args];
    return ['deploy', '--config', relative(cwd, GENERATED_CONFIG) || GENERATED_CONFIG, ...args];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = deployArgs(process.argv.slice(2), existsSync(GENERATED_CONFIG));
    console.log(`> firebase ${args.join(' ')}`);
    const result = spawnSync('firebase', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    process.exitCode = result.status ?? 1;
}
