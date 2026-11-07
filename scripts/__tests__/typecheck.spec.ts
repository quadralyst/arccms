import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// @ts-expect-error: plain ESM script without type declarations
import { CHECKS, typecheck } from '../typecheck.mjs';

// Vitest does not type-check, so without this a type error passes the suite and
// only shows when `npm run build` or a deploy fails (8682d57 shipped one).
describe('typecheck', () => {
    it('checks the app as the production build compiles it, and the functions', () => {
        expect(CHECKS.map((check: { args: string[] }) => check.args[1])).toEqual(['tsconfig.app.json', 'functions/tsconfig.json']);
        const app = ts.parseConfigFileTextToJson('tsconfig.app.json', readFileSync('tsconfig.app.json', 'utf8')).config;
        // The build compiles the app's file-based pages too (vite.config.ts additionalPagesDirs).
        expect(app.include).toEqual(expect.arrayContaining(['src/app/pages/**/*.page.ts', 'src/custom/pages/**/*.page.ts']));
    });

    // npm run gate has just run this same check before starting the suite (scripts/gate.mjs).
    it.skipIf(process.env.ARC_GATE_TYPECHECK_PASSED === '1')('finds no type errors in the app or the functions', async () => {
        const results: { name: string; ok: boolean; output: string }[] = await typecheck();
        for (const result of results) {
            expect(result.ok, `${result.name} has type errors (npm run typecheck):\n${result.output}`).toBe(true);
        }
    }, 300_000);
});
