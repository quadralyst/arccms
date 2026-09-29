/**
 * The functions' side of the features (docs/feature-flags-spec.md, section 5):
 * the ids agree with the frontend's, each feature's functions live in its own
 * file, and the generator writes the files all.ts builds from.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FEATURE_IDS } from '../feature-flags.js';
import { FEATURE_IDS as FRONTEND_FEATURE_IDS } from '../../../src/app/core/features/feature-registry';
// @ts-expect-error plain JavaScript script, no types
import { renderFeatureFiles } from '../../../scripts/arc-features.mjs';

const SRC = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');
const exportedModules = (source: string) => [...source.matchAll(/from '\.\.?\/([^']+)\.js'/g)].map((m) => m[1].replace(/^\.\.\//, ''));

describe('function features', () => {
    it('know the same features as the frontend', () => {
        expect([...FEATURE_IDS]).toEqual([...FRONTEND_FEATURE_IDS]);
    });

    it('keep one file per feature, named after it', () => {
        for (const file of readdirSync(resolve(SRC, 'features'))) {
            expect(FEATURE_IDS).toContain(file.replace(/\.ts$/, ''));
        }
    });

    it('never export a module from both core and a feature', () => {
        const core = new Set(exportedModules(read('all.ts')));
        for (const file of readdirSync(resolve(SRC, 'features'))) {
            for (const module of exportedModules(read(`features/${file}`))) {
                expect(core.has(module), `${module} is in all.ts and features/${file}`).toBe(false);
            }
        }
    });

    it('export the features through the generated file, and the app functions last', () => {
        const all = read('all.ts');
        expect(all).toContain("export * from './feature-exports.gen.js';");
        expect(all.trim().endsWith("export * as custom from './custom/index.js';")).toBe(true);
    });
});

describe('arc-features generator', () => {
    it('lists the features that are on, and exports the functions of those that have any', () => {
        const { enabledFile, exportsFile } = renderFeatureFiles(['content', 'data', 'pwa'], (id: string) => id !== 'data');
        expect(enabledFile).toContain('export const ENABLED_FEATURES: readonly string[] = ["content","data","pwa"];');
        expect(exportsFile).toContain("export * from './features/content.js';\nexport * from './features/pwa.js';");
        expect(exportsFile).not.toContain('data');
    });

    it('writes a module even with no optional features', () => {
        const { enabledFile, exportsFile } = renderFeatureFiles([], () => true);
        expect(enabledFile).toContain('= [];');
        expect(exportsFile).toContain('export {};');
    });

    it('runs before every functions build', () => {
        const pkg = JSON.parse(readFileSync(resolve(SRC, '../package.json'), 'utf8'));
        expect(pkg.scripts.prebuild).toBe('node ../scripts/arc-features.mjs');
    });
});
