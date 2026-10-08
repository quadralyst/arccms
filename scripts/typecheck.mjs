/**
 * `npm run typecheck`: type-checks what gets released, without building it.
 *
 *   the app        ngc over tsconfig.app.json, templates included, as the
 *                  production build (`npm run build`) compiles it
 *   the functions  tsc over functions/src, as `npm run build --prefix functions` does
 *
 * Vitest strips types without checking them, so a type error passes every unit
 * test and only shows when a build or a deploy fails. The suite runs this too
 * (scripts/__tests__/typecheck.spec.ts), so `npm run test` fails on a type error.
 *
 * Writes the functions' generated files first (scripts/arc-features.mjs,
 * scripts/arc-site-defaults.mjs), which a fresh clone does not have yet.
 * Exits 1 when either check finds an error.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The functions' own TypeScript when they have one, so the check matches their build. */
const functionsTsc = () => [resolve(ROOT, 'functions/node_modules/typescript/bin/tsc'), resolve(ROOT, 'node_modules/typescript/bin/tsc')]
    .find((path) => existsSync(path));

export const CHECKS = [
    { name: 'app', bin: () => resolve(ROOT, 'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js'), args: ['-p', 'tsconfig.app.json', '--noEmit'] },
    { name: 'functions', bin: functionsTsc, args: ['-p', 'functions/tsconfig.json', '--noEmit'] },
];

function run(check) {
    return new Promise((done) => {
        let output = '';
        const child = spawn(process.execPath, [check.bin(), ...check.args], { cwd: ROOT });
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.on('close', (code) => done({ name: check.name, ok: code === 0, output: output.trim() }));
    });
}

/** Runs both checks at once; resolves to one result per check. */
export async function typecheck() {
    execFileSync(process.execPath, [resolve(ROOT, 'scripts/arc-features.mjs')], { stdio: ['ignore', 'ignore', 'inherit'] });
    execFileSync(process.execPath, [resolve(ROOT, 'scripts/arc-site-defaults.mjs')], { stdio: ['ignore', 'ignore', 'inherit'] });
    return Promise.all(CHECKS.map(run));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const results = await typecheck();
    for (const result of results) {
        console.log(result.ok ? `✓ ${result.name}: no type errors` : `✗ ${result.name}: type errors\n\n${result.output}\n`);
    }
    process.exit(results.every((result) => result.ok) ? 0 : 1);
}
