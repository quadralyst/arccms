/**
 * Runs once before the test run: writes the functions' generated feature files
 * (scripts/arc-features.mjs), which functions code imports. They are gitignored,
 * so a fresh clone has none until a build or a test run makes them.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function setup(): void {
    execFileSync(process.execPath, [resolve(__dirname, 'arc-features.mjs')], { stdio: 'inherit' });
}
