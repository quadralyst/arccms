/**
 * The functions' side of the features (docs/feature-flags-spec.md, section 5):
 * the ids agree with the frontend's, each feature's functions live in its own
 * file, and the generator writes the files all.ts builds from.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FEATURE_IDS } from '../feature-flags.js';
// @ts-expect-error plain JavaScript script, no types
import { renderFeatureFiles } from '../../../scripts/arc-features.mjs';

const SRC = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');
const exportedModules = (source: string) => [...source.matchAll(/from '\.\.?\/([^']+)\.js'/g)].map((m) => m[1].replace(/^\.\.\//, ''));

describe('function features', () => {
    it('know the same features as the frontend', () => {
        // Read as text: importing a file outside functions/src would move the build output.
        const registry = readFileSync(resolve(SRC, '../../src/app/core/features/feature-registry.ts'), 'utf8');
        const list = registry.match(/export const FEATURE_IDS = \[([^\]]*)\]/)?.[1] ?? '';
        expect([...list.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...FEATURE_IDS]);
    });

    it('keep one file per feature, or per set of features joined with +, named after them', () => {
        for (const file of readdirSync(resolve(SRC, 'features'))) {
            for (const id of file.replace(/\.ts$/, '').split('+')) expect(FEATURE_IDS).toContain(id);
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

    it('export every file that defines a Cloud Function, from core or from one feature (docs/feature-flags-spec.md 8)', () => {
        const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]);
        const skip = /\/(__tests__|custom|features)\/|\.spec\.ts$|\.gen\.ts$/;
        const defines = /export const \w+ = (onCall|onRequest|onSchedule|onDocument\w+|Object\.fromEntries)\(/;
        const withFunctions = walk(SRC)
            .filter((f) => f.endsWith('.ts') && !skip.test(f) && defines.test(readFileSync(f, 'utf8')))
            .map((f) => f.slice(SRC.length + 1).replace(/\.ts$/, ''));
        expect(withFunctions.length).toBeGreaterThan(80);

        const exportedBy = new Map<string, string[]>();
        const note = (file: string, from: string) => exportedBy.set(file, [...(exportedBy.get(file) ?? []), from]);
        for (const m of exportedModules(read('all.ts'))) note(m, 'core');
        for (const file of readdirSync(resolve(SRC, 'features'))) {
            for (const m of exportedModules(read(`features/${file}`))) note(m, `feature ${file.replace(/\.ts$/, '')}`);
        }
        const problems = withFunctions
            .filter((f) => (exportedBy.get(f) ?? []).length !== 1)
            .map((f) => `${f}: ${exportedBy.get(f)?.join(' and ') ?? 'not exported. Add it to all.ts (core) or to a feature file'}`);
        expect(problems).toEqual([]);
    });

    it('export the features through the generated file, and the app functions last', () => {
        const all = read('all.ts');
        expect(all).toContain("export * from './feature-exports.gen.js';");
        expect(all.trim().endsWith("export * as custom from './custom/index.js';")).toBe(true);
    });
});

describe('arc-features generator', () => {
    it('lists the features that are on, and exports the files whose features are all on', () => {
        const files = ['content', 'pwa', 'search', 'search+content'];
        const { enabledFile, exportsFile } = renderFeatureFiles(['content', 'data', 'pwa'], files);
        expect(enabledFile).toContain('export const ENABLED_FEATURES: readonly string[] = ["content","data","pwa"];');
        expect(exportsFile).toContain("export * from './features/content.js';\nexport * from './features/pwa.js';");
        expect(exportsFile).not.toContain('search');

        expect(renderFeatureFiles(['content', 'search'], files).exportsFile).toContain("export * from './features/search+content.js';");
    });

    it('writes a module even with no optional features', () => {
        const { enabledFile, exportsFile } = renderFeatureFiles([], ['content']);
        expect(enabledFile).toContain('= [];');
        expect(exportsFile).toContain('export {};');
    });

    it('runs before every functions build', () => {
        const pkg = JSON.parse(readFileSync(resolve(SRC, '../package.json'), 'utf8'));
        expect(pkg.scripts.prebuild).toBe('node ../scripts/arc-features.mjs');
    });
});
