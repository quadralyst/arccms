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
import { NO_PROJECT_MESSAGE, defaultEnvironment, environmentFor, environmentSwap, projectIdIn, projectLine } from '../arc-environment.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { buildsFor, websiteBuildEnv } from '../arc-deploy.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { buildProject } from '../arc-build.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { main as configure } from '../arc-configure.mjs';
import { pathToFileURL } from 'node:url';

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

describe('npm run dev and npm run build without ARC_PROJECT (defaultEnvironment)', () => {
    let root: string;
    const REPO = resolve(__dirname, '../..');
    const env = (name: string, projectId: string) =>
        writeFileSync(join(root, 'src/environments', name), `export const environment = { firebaseConfig: { projectId: '${projectId}' } };\n`);

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'arc-env-default-'));
        mkdirSync(join(root, 'src/environments'), { recursive: true });
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('uses the default alias\'s project once arc:configure has written its web settings, in dev and in a production build', () => {
        env('environment.ts', 'someone-else');
        writeFileSync(join(root, 'src/environments/firebase-web.acme-dev.ts'), 'projectId: "acme-dev"');
        for (const production of [false, true]) {
            const found = defaultEnvironment({ production, root, aliases: { default: 'acme-dev' } });
            expect(found).toEqual({ projectId: 'acme-dev', file: join(root, 'src/environments/firebase-web.acme-dev.ts'), source: 'the default alias' });
            expect(projectLine(found)).toBe('Firebase project: acme-dev (the default alias, environments/firebase-web.acme-dev.ts)');
        }
    });

    it('falls back to the environment file only when the default alias has no web settings file', () => {
        env('environment.ts', 'acme-dev');
        env('environment.prod.ts', 'acme-prod');
        expect(defaultEnvironment({ root, aliases: { default: 'acme-dev' } })).toMatchObject({ projectId: 'acme-dev', source: 'environment file' });
        expect(defaultEnvironment({ production: true, root, aliases: {} })).toMatchObject({ projectId: 'acme-prod' });
    });

    it('stops with what to run when no project is set up, as in a fresh copy of Arc CMS', () => {
        for (const name of ['environment.ts', 'environment.prod.ts']) {
            writeFileSync(join(root, 'src/environments', name), readFileSync(join(REPO, 'src/environments', name), 'utf8'));
        }
        expect(() => defaultEnvironment({ root, aliases: {} })).toThrow(NO_PROJECT_MESSAGE);
        expect(() => defaultEnvironment({ production: true, root, aliases: { default: 'acme-dev' } })).toThrow(NO_PROJECT_MESSAGE);
        expect(NO_PROJECT_MESSAGE).toContain('No Firebase project configured: run npm run arc:configure');
    });

    it('is what vite.config.ts uses when ARC_PROJECT is not set', () => {
        const config = readFileSync(join(REPO, 'vite.config.ts'), 'utf8');
        expect(config).toContain('defaultEnvironment({ production: mode === \'production\' && process.env[\'USE_DEV_ENV\'] !== \'true\' })');
        expect(config).toContain('console.log(projectLine(found))');
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


describe('a staging project built like production (build mode)', () => {
    let root: string;
    const write = (path: string, text: string) => {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), text);
    };
    const web = { apiKey: 'k', authDomain: 'acme-staging.firebaseapp.com', projectId: 'acme-staging', appId: '1:2:web:3' };

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'arc-build-mode-'));
        mkdirSync(join(root, 'functions'));
        write('.firebaserc', JSON.stringify({ projects: { default: 'acme-dev', staging: 'acme-staging' } }));
        write('web.json', JSON.stringify(web));
        // The base file, with keys of the app's own next to the two a project build sets.
        write('src/environments/environment.ts', `export const environment = {
    production: false,
    supportEmail: 'help@example.test',
    limits: { uploadMb: 5 },
    firebaseConfig: { apiKey: 'dev', projectId: 'acme-dev', appId: 'dev-app' },
};
`);
        write('src/environments/index.ts', "export * from './environment';\n");
        // What the app reads: debug mode (GlobalService) and the sign-in instance label (SignupPage).
        write('src/app/debug.ts', "import { environment } from '../environments/environment';\nexport const debugMode = !environment.production;\n");
        write('src/app/pages/auth/label.ts', "import { environment } from '../../../environments/environment';\n"
            + "export const instanceLabel = environment.production ? '' : environment.firebaseConfig.projectId;\n");
        write('src/app/keys.ts', "import { environment } from '../environments';\nexport const supportEmail = environment.supportEmail;\nexport const uploadMb = environment.limits.uploadMb;\nexport const projectId = environment.firebaseConfig.projectId;\n");
        write('src/main.ts', "export { debugMode } from './app/debug';\nexport { instanceLabel } from './app/pages/auth/label';\nexport * from './app/keys';\n");
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    const configureStaging = (...flags: string[]) => configure(['--project=staging', '--web-config=web.json', ...flags], {
        config: join(root, 'arccms.config.json'), firebase: join(root, 'firebase.json'), firebaserc: join(root, '.firebaserc'),
        root, install: join(root, 'src/environments/arc-install.ts'), functionsDir: join(root, 'functions'),
    }, () => undefined);

    /** Builds the fixture app for staging as vite.config.ts does, and loads what it exports. */
    async function builtFor(alias: string): Promise<Record<string, unknown>> {
        const { file } = environmentFor(alias, { root });
        const result = await build({
            root, configFile: false, logLevel: 'silent',
            plugins: [environmentSwap(file, { root })],
            build: { write: false, minify: false, lib: { entry: join(root, 'src/main.ts'), formats: ['es'], fileName: 'main' } },
        });
        const outputs = (Array.isArray(result) ? result : [result]) as { output: { code?: string }[] }[];
        const out = join(root, 'out.mjs');
        writeFileSync(out, outputs.flatMap((r) => r.output.map((o) => o.code ?? '')).join('\n'));
        return import(`${pathToFileURL(out).href}?t=${Date.now()}`);
    }

    it('has no debug mode or instance label, talks only to staging and keeps every other key', async () => {
        expect(configureStaging('--build-mode=production')).toBe(0);
        const app = await builtFor('staging');
        expect(app).toMatchObject({ debugMode: false, instanceLabel: '', projectId: 'acme-staging', supportEmail: 'help@example.test', uploadMb: 5 });
    }, 30_000);

    it('builds in development mode by default, as before, with the same keys', async () => {
        expect(configureStaging()).toBe(0);
        const app = await builtFor('staging');
        expect(app).toMatchObject({ debugMode: true, instanceLabel: 'acme-staging', projectId: 'acme-staging', supportEmail: 'help@example.test', uploadMb: 5 });
    }, 30_000);

    it('takes a later edit of environment.ts without configuring again', async () => {
        expect(configureStaging('--build-mode=production')).toBe(0);
        write('src/environments/environment.ts', readFileSync(join(root, 'src/environments/environment.ts'), 'utf8').replace('help@example.test', 'desk@example.test'));
        expect((await builtFor('staging')).supportEmail).toBe('desk@example.test');
    }, 30_000);
});
