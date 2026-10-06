/**
 * Which web settings a build uses (specs/app-project-settings-spec.md, E-D3 to E-D5).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { environmentFor, projectIdIn } from '../arc-environment.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { buildsFor, websiteBuildEnv } from '../arc-deploy.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { buildProject } from '../arc-build.mjs';

describe('environmentFor', () => {
    let root: string;
    const aliases = { default: 'acme-dev', staging: 'acme-staging', production: 'acme-prod' };
    const env = (name: string, projectId: string) =>
        writeFileSync(join(root, 'src/environments', name), `export const environment = { firebaseConfig: { projectId: '${projectId}' } };\n`);

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'arc-env-'));
        mkdirSync(join(root, 'src/environments'), { recursive: true });
        env('environment.ts', 'acme-dev');
        env('environment.prod.ts', 'acme-prod');
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('uses the project\'s generated web settings, by alias or id', () => {
        writeFileSync(join(root, 'src/environments/firebase-web.acme-staging.ts'), 'projectId: "acme-staging"');
        expect(environmentFor('staging', { root, aliases })).toMatchObject({ projectId: 'acme-staging', source: 'generated' });
        expect(environmentFor('acme-staging', { root, aliases }).file).toBe(join(root, 'src/environments/firebase-web.acme-staging.ts'));
    });

    it('keeps a two-project install working: environment.ts for default, environment.prod.ts for production', () => {
        expect(environmentFor('default', { root, aliases }).file).toBe(join(root, 'src/environments/environment.ts'));
        expect(environmentFor('production', { root, aliases }).file).toBe(join(root, 'src/environments/environment.prod.ts'));
        expect(environmentFor('acme-prod', { root, aliases }).file).toBe(join(root, 'src/environments/environment.prod.ts'));
    });

    it('never builds a site that talks to another project, and says how to fix it', () => {
        expect(() => environmentFor('staging', { root, aliases }))
            .toThrow('No web settings for acme-staging: src/environments/environment.ts is for acme-dev, so the site would talk to the wrong project. '
                + 'Add them with: npm run arc:configure -- --project=staging --web-config=fetch');
        env('environment.prod.ts', 'acme-dev');
        expect(() => environmentFor('production', { root, aliases })).toThrow('environment.prod.ts is for acme-dev');
    });

    it('reads the project id from either quote style', () => {
        expect(projectIdIn("projectId: 'a'")).toBe('a');
        expect(projectIdIn('projectId: "b"')).toBe('b');
        expect(projectIdIn('')).toBe('');
    });
});

describe('a deploy always builds first (E-D6)', () => {
    it('builds the website and the functions it deploys, and nothing for rules', () => {
        expect(buildsFor({ website: true, functions: true })).toEqual(['website', 'functions']);
        expect(buildsFor({ website: true, functions: false })).toEqual(['website']);
        expect(buildsFor({ website: false, functions: false })).toEqual([]);
        // The guided deploy built the functions moments ago; the website is still always built.
        expect(buildsFor({ website: true, functions: true, functionsBuilt: true })).toEqual(['website']);
    });

    it('builds the website with the target project\'s settings, never the old dev switch', () => {
        const env = websiteBuildEnv('acme-staging', { PATH: '/bin', USE_DEV_ENV: 'true' });
        expect(env).toEqual({ PATH: '/bin', ARC_PROJECT: 'acme-staging' });
    });

    it('npm run build:project takes an alias or an id', () => {
        expect(buildProject(['--project=staging'], { staging: 'acme-staging' })).toBe('acme-staging');
        expect(buildProject(['--project=acme-x'], {})).toBe('acme-x');
        expect(buildProject([], {})).toBe('');
    });
});
