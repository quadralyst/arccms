/**
 * The install files Arc CMS ships (docs/app/environments.html): environment.ts,
 * environment.prod.ts and arc-install.ts name no Firebase project, so a new copy
 * never talks to Arc CMS's own project, and an app that fills them in never has a
 * merge conflict on their values. Arc CMS's own project lives in an untracked
 * firebase-web.<id>.ts, like any other project's settings.
 *
 * Only in Arc CMS itself: an app fills these files in. Detected the way check:core
 * detects Arc CMS itself.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain ESM script without type declarations
import { isArcCmsRepository } from '../check-core.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { projectIdIn } from '../arc-environment.mjs';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe.skipIf(!isArcCmsRepository(ROOT))('the install files Arc CMS ships', () => {
    it('name no Firebase project', () => {
        for (const file of ['src/environments/environment.ts', 'src/environments/environment.prod.ts']) {
            expect(projectIdIn(read(file)), file).toBe('');
            expect(read(file), file).not.toMatch(/apiKey:\s*['"][^'"]+['"]/);
        }
        expect(read('src/environments/arc-install.ts')).toMatch(/^export const arcInstall: Record<string, ArcInstallConfig> = \{\};$/m);
    });

    it('include no project\'s generated web settings', () => {
        const tracked = execFileSync('git', ['ls-files', 'src/environments'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
        expect(tracked.filter((path) => /firebase-web\.[^/]+\.ts$/.test(path))).toEqual([]);
    });
});
