// @vitest-environment node
/**
 * Which web settings a build uses (specs/app-project-settings-spec.md, E-D3 to E-D5).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { build } from 'vite';
// @ts-expect-error: plain ESM script without type declarations
import { environmentFor, environmentSwap, projectIdIn } from '../arc-environment.mjs';
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

describe('every import gets the build\'s environment file (environmentSwap)', () => {
    let root: string;
    const write = (path: string, text: string) => {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), text);
    };

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'arc-swap-'));
        write('src/environments/environment.ts', "export const environment = { firebaseConfig: { projectId: 'acme-dev' } };\n");
        write('src/environments/firebase-web.acme-staging.ts', "export const environment = { firebaseConfig: { projectId: 'acme-staging' } };\n");
        write('src/environments/index.ts', "export * from './environment';\n");
        // The ways the app imports it: next to it, three folders down (what the old swap missed), and the barrel.
        write('src/app/near.ts', "import { environment } from '../environments/environment';\nexport const near = environment.firebaseConfig.projectId;\n");
        write('src/app/core/analytics/deep.ts', "import { environment } from '../../../environments/environment';\nexport const deep = environment.firebaseConfig.projectId;\n");
        write('src/app/barrel.ts', "import { environment } from '../environments';\nexport const barrel = environment.firebaseConfig.projectId;\n");
        write('src/main.ts', "export { near } from './app/near';\nexport { deep } from './app/core/analytics/deep';\nexport { barrel } from './app/barrel';\n");
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    async function built(target: string | null): Promise<string> {
        const result = await build({
            root, configFile: false, logLevel: 'silent',
            plugins: [environmentSwap(target, { root })],
            build: { write: false, minify: false, lib: { entry: join(root, 'src/main.ts'), formats: ['es'], fileName: 'main' } },
        });
        const outputs = (Array.isArray(result) ? result : [result]) as { output: { code?: string }[] }[];
        return outputs.flatMap((r) => r.output.map((o) => o.code ?? '')).join('\n');
    }

    it('serves the project\'s file to every import, however it is written', async () => {
        const code = await built(join(root, 'src/environments/firebase-web.acme-staging.ts'));
        expect(code).toContain('acme-staging');
        expect(code).not.toContain('acme-dev');
    }, 30_000);

    it('changes nothing without a target', async () => {
        const code = await built(null);
        expect(code).toContain('acme-dev');
        expect(code).not.toContain('acme-staging');
    }, 30_000);

    it('is what vite.config.ts uses, with no import aliases for the environment file', () => {
        const config = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');
        expect(config).toContain('environmentSwap(');
        expect(config).not.toMatch(/['"]\.\.\/environments\/environment['"]\s*:/);
    });
});

