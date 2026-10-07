// @vitest-environment node
/**
 * The Firebase CLI is pinned once, in the root package.json, where the npm scripts
 * (deploy, test:rules, and those in functions/) find it. It must stay out of the
 * functions' dependencies: Cloud Build installs those on every functions deploy, and
 * the CLI is hundreds of packages the deployed code never loads.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(__dirname, '../..');
const json = (path: string) => JSON.parse(readFileSync(join(REPO, path), 'utf8'));

describe('the pinned Firebase CLI', () => {
    it('is a root dev dependency', () => {
        expect(json('package.json').devDependencies['firebase-tools']).toBeTruthy();
    });

    it('is not a dependency of the deployed functions', () => {
        const pkg = json('functions/package.json');
        expect(pkg.dependencies?.['firebase-tools']).toBeUndefined();
        expect(pkg.devDependencies?.['firebase-tools']).toBeUndefined();
    });

    it('is not looked for in functions/node_modules by the CI example', () => {
        expect(readFileSync(join(REPO, 'docs/app/ci.html'), 'utf8')).not.toContain('functions/node_modules/.bin');
    });
});
