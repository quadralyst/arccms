/**
 * Runs once before the test run: writes the functions' generated files, the
 * features (scripts/arc-features.mjs) and the default templates
 * (scripts/arc-site-defaults.mjs), which functions code imports. They are
 * gitignored, so a fresh clone has none until a build or a test run makes them.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function setup(): void {
    execFileSync(process.execPath, [resolve(__dirname, 'arc-features.mjs')], { stdio: 'inherit' });
    execFileSync(process.execPath, [resolve(__dirname, 'arc-site-defaults.mjs')], { stdio: 'inherit' });
}
