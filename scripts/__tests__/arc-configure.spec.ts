import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import * as configure from '../arc-configure.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { deployArgs, deploysFunctions, generatedConfigPath, projectArg } from '../arc-deploy.mjs';

const ROOT = resolve(__dirname, '..', '..');
const committedFirebase = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const backend = {
    profile: 'backend',
    databaseId: 'arccms',
    hostingSite: 'acme-admin',
    storageBucket: 'acme-arccms',
};

describe('arc-configure', () => {
    describe('defaults: a standalone install is left exactly as it was', () => {
        const config = configure.normalizeConfig({});

        it('is valid with no config at all', () => {
            expect(config).toEqual({ profile: 'standalone' });
            expect(configure.validateConfig(config)).toEqual([]);
        });

        it('generates no Firebase config, so the committed firebase.json is used', () => {
            expect(configure.renderFirebaseConfig(committedFirebase, config)).toBeNull();
        });

        it('renders an empty arc-install.ts, byte for byte the committed one', () => {
            const rendered = configure.renderArcInstall({ 'some-project': config });
            expect(rendered).toContain('export const arcInstall: Record<string, ArcInstallConfig> = {};');
            expect(configure.renderArcInstall({})).toBe(rendered);
        });

        it('writes ARC_DATABASE_ID=(default), which a non-interactive deploy needs, and keeps other lines', () => {
            expect(configure.updateFunctionsEnv('', config)).toBe('ARC_DATABASE_ID=(default)\n');
            expect(configure.updateFunctionsEnv('RESEND_KEY=x\nARC_DATABASE_ID=old\n', config))
                .toBe('RESEND_KEY=x\nARC_DATABASE_ID=(default)\n');
        });

        it('matches the committed functions/.env, so a fresh clone deploys without running configure', () => {
            const committed = readFileSync(join(ROOT, 'functions/.env'), 'utf8');
            expect(committed).toMatch(/^ARC_DATABASE_ID=\(default\)$/m);
        });

        it('prints no setup commands', () => {
            expect(configure.setupCommands(config)).toEqual([]);
        });
    });

    describe('validation', () => {
        it('refuses a backend install on the (default) database (CO-D11)', () => {
            const errors = configure.validateConfig(configure.normalizeConfig({ ...backend, databaseId: '(default)' }));
            expect(errors.join(' ')).toMatch(/own database/);
        });

        it('requires a backend install to have its own hosting site and bucket', () => {
            const errors = configure.validateConfig(configure.normalizeConfig({ profile: 'backend', databaseId: 'arccms' }));
            expect(errors).toHaveLength(2);
        });

        it('rejects unknown profiles and invalid database ids', () => {
            expect(configure.validateConfig(configure.normalizeConfig({ profile: 'wordpress' }))).toHaveLength(1);
            expect(configure.validateConfig(configure.normalizeConfig({ databaseId: 'ArcCMS_db' }))).toHaveLength(1);
        });

        it('rejects unknown flags', () => {
            expect(() => configure.parseFlags(['--databse=arccms'])).toThrow(/Unknown argument/);
        });
    });

    describe('backend profile', () => {
        const config = configure.normalizeConfig({ ...backend, storageBucket: 'gs://acme-arccms/' });

        it('points the Firebase CLI at the named database, own bucket and own site', () => {
            const out = configure.renderFirebaseConfig(committedFirebase, config);
            expect(out.firestore).toEqual([{
                database: 'arccms',
                rules: committedFirebase.firestore.rules,
                indexes: committedFirebase.firestore.indexes,
            }]);
            expect(out.storage).toEqual([{ bucket: 'acme-arccms', rules: committedFirebase.storage.rules }]);
            expect(out.hosting.site).toBe('acme-admin');
            expect(out.hosting.rewrites).toEqual(committedFirebase.hosting.rewrites);
            expect(out.functions).toEqual(committedFirebase.functions);
        });

        it('writes the app values into arc-install.ts under the project id, leaving default projects out', () => {
            const rendered = configure.renderArcInstall({
                'acme-prod': { ...config, storagePrefix: 'arccms/' },
                'acme-dev': configure.normalizeConfig({}),
            });
            expect(rendered).toContain('"acme-prod": {');
            expect(rendered).toContain('databaseId: "arccms"');
            expect(rendered).toContain('storageBucket: "acme-arccms"');
            expect(rendered).toContain('storagePrefix: "arccms/"');
            expect(rendered).not.toContain('acme-dev');
        });

        it('sets the ARC_* keys in functions/.env, replacing old values', () => {
            expect(configure.updateFunctionsEnv('RESEND_KEY=x\nARC_DATABASE_ID=old\n', config))
                .toBe('RESEND_KEY=x\nARC_DATABASE_ID=arccms\nARC_HOSTING_SITE=acme-admin\n');
        });

        it('prints the commands that create the resources', () => {
            const commands = configure.setupCommands({ ...config, region: 'nam5' }).join('\n');
            expect(commands).toContain('firebase firestore:databases:create arccms --location=nam5');
            expect(commands).toContain('firebase hosting:sites:create acme-admin');
            expect(commands).toContain('gs://acme-arccms');
        });
    });

    describe('main', () => {
        let dir: string;
        let paths: Record<string, string>;
        const log: string[] = [];
        const envFor = (id: string) => join(dir, 'functions', `.env.${id}`);
        const generated = (id: string) => join(dir, `firebase.${id}.json`);

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'arc-configure-'));
            mkdirSync(join(dir, 'functions'));
            paths = {
                config: join(dir, 'arccms.config.json'),
                firebase: join(dir, 'firebase.json'),
                firebaserc: join(dir, '.firebaserc'),
                root: dir,
                install: join(dir, 'arc-install.ts'),
                functionsDir: join(dir, 'functions'),
            };
            writeFileSync(paths.firebase, JSON.stringify(committedFirebase));
            writeFileSync(paths.firebaserc, JSON.stringify({ projects: { default: 'acme-dev', prod: 'acme-prod' } }));
            writeFileSync(join(dir, 'functions', '.env'), 'ARC_DATABASE_ID=(default)\n');
            writeFileSync(envFor('acme-prod'), 'RESEND_KEY=x\n');
            log.length = 0;
        });
        afterEach(() => rmSync(dir, { recursive: true, force: true }));

        const run = (...args: string[]) => configure.main(args, paths, (line: string) => log.push(line));

        it('configures one project from flags, leaving the others and the shared .env alone', () => {
            expect(run('--project=prod', '--profile=backend', '--database=arccms', '--site=acme-admin', '--bucket=acme-arccms')).toBe(0);

            expect(JSON.parse(readFileSync(paths.config, 'utf8'))).toEqual({ projects: { 'acme-prod': backend } });
            expect(existsSync(generated('acme-prod'))).toBe(true);
            expect(existsSync(generated('acme-dev'))).toBe(false);
            expect(readFileSync(envFor('acme-prod'), 'utf8')).toBe('RESEND_KEY=x\nARC_DATABASE_ID=arccms\nARC_HOSTING_SITE=acme-admin\n');
            expect(readFileSync(join(dir, 'functions', '.env'), 'utf8')).toBe('ARC_DATABASE_ID=(default)\n');
            expect(readFileSync(paths.install, 'utf8')).toContain('"acme-prod": {');

            // Running again changes nothing.
            log.length = 0;
            expect(run('--project=prod')).toBe(0);
            expect(log).toContain('Nothing to change.');

            // The default project stays default: its env says so and it gets no generated config.
            expect(run()).toBe(0);
            expect(readFileSync(envFor('acme-dev'), 'utf8')).toBe('ARC_DATABASE_ID=(default)\n');
            expect(existsSync(generated('acme-dev'))).toBe(false);

            // Back to standalone for prod: its generated config goes, other env lines stay.
            writeFileSync(paths.config, '{}');
            expect(run('--project=acme-prod')).toBe(0);
            expect(existsSync(generated('acme-prod'))).toBe(false);
            expect(readFileSync(envFor('acme-prod'), 'utf8')).toBe('RESEND_KEY=x\nARC_DATABASE_ID=(default)\n');
            expect(readFileSync(paths.install, 'utf8')).toContain('= {};');
        });

        it('applies shared top-level keys to every project (a pre-CO3.2 file)', () => {
            writeFileSync(paths.config, JSON.stringify({ databaseId: 'arccms' }));
            expect(run('--project=prod')).toBe(0);
            expect(readFileSync(envFor('acme-prod'), 'utf8')).toContain('ARC_DATABASE_ID=arccms');
        });

        it('refuses an unsafe config and writes nothing', () => {
            expect(run('--project=prod', '--profile=backend')).toBe(1);
            expect(existsSync(paths.config)).toBe(false);
            expect(existsSync(paths.install)).toBe(false);
        });

        it('--dry-run writes nothing', () => {
            expect(run('--project=prod', '--profile=backend', '--database=arccms', '--site=a-site', '--bucket=a-bucket', '--dry-run')).toBe(0);
            expect(existsSync(paths.config)).toBe(false);
            expect(existsSync(generated('acme-prod'))).toBe(false);
            expect(log.join('\n')).toMatch(/Would create/);
        });
    });
});

describe('arc-deploy', () => {
    it('is plain firebase deploy without a generated config', () => {
        expect(deployArgs(['--only', 'functions', '--project', 'dev'], false, 'acme-dev'))
            .toEqual(['deploy', '--only', 'functions', '--project', 'dev']);
    });

    it("adds the target project's generated config when there is one", () => {
        expect(deployArgs(['--only', 'functions'], true, 'acme-prod', ROOT))
            .toEqual(['deploy', '--config', 'firebase.acme-prod.json', '--only', 'functions']);
        expect(generatedConfigPath('acme-prod')).toBe(join(ROOT, 'firebase.acme-prod.json'));
    });

    it('leaves an explicit --config alone and never passes --no-probe to firebase', () => {
        expect(deployArgs(['--config', 'other.json', '--no-probe'], true, 'acme-prod')).toEqual(['deploy', '--config', 'other.json']);
    });

    it('finds the project in every form the CLI accepts', () => {
        expect(projectArg(['--project', 'prod'])).toBe('prod');
        expect(projectArg(['--project=prod'])).toBe('prod');
        expect(projectArg(['-P', 'prod'])).toBe('prod');
        expect(projectArg(['--only', 'functions'])).toBe('');
    });

    it('knows when a deploy includes functions (and so needs the callable check)', () => {
        expect(deploysFunctions([])).toBe(true);
        expect(deploysFunctions(['--only', 'functions:arccms:arccms.search'])).toBe(true);
        expect(deploysFunctions(['--only=hosting,functions'])).toBe(true);
        expect(deploysFunctions(['--only', 'firestore,hosting'])).toBe(false);
    });
});
