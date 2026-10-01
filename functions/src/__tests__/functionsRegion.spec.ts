/**
 * Every function runs in the install's region, next to its database
 * (ARC_FUNCTIONS_REGION, docs/operations/deploy.html#regions).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { arcFunctionsRegion, DEFAULT_FUNCTIONS_REGION } from '../arc-config.js';
import { searchEndpoint } from '../search/widget.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== '__tests__') sources(full, acc);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
            acc.push(full);
        }
    }
    return acc;
}

describe('the functions region', () => {
    const saved = process.env.ARC_FUNCTIONS_REGION;
    afterEach(() => {
        if (saved === undefined) delete process.env.ARC_FUNCTIONS_REGION;
        else process.env.ARC_FUNCTIONS_REGION = saved;
    });

    it('is ARC_FUNCTIONS_REGION, else us-central1', () => {
        expect(arcFunctionsRegion({})).toBe(DEFAULT_FUNCTIONS_REGION);
        expect(arcFunctionsRegion({ ARC_FUNCTIONS_REGION: ' asia-south1 ' })).toBe('asia-south1');
    });

    it('is set for every function before any is defined', () => {
        const index = readFileSync(join(SRC, 'index.ts'), 'utf8');
        expect(index.indexOf("import './region.js';")).toBeGreaterThan(-1);
        expect(index.indexOf("import './region.js';")).toBeLessThan(index.indexOf("from './all.js'"));
        expect(readFileSync(join(SRC, 'region.ts'), 'utf8')).toContain('setGlobalOptions({ region: arcFunctionsRegionParam })');
    });

    it('is not overridden by any function', () => {
        const own = sources(SRC).filter((file) => /\bregion\s*:\s*['"]/.test(readFileSync(file, 'utf8')));
        expect(own.map((file) => relative(SRC, file))).toEqual([]);
    });

    it('is where the published search widget calls the search function', () => {
        process.env.ARC_FUNCTIONS_REGION = 'asia-south1';
        expect(searchEndpoint('demo')).toBe('https://asia-south1-demo.cloudfunctions.net/arccms-search');
        delete process.env.ARC_FUNCTIONS_REGION;
        expect(searchEndpoint('demo')).toBe('https://us-central1-demo.cloudfunctions.net/arccms-search');
    });
});
