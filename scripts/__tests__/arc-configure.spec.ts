import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import * as configure from '../arc-configure.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { deployArgs, deploysFunctions, generatedConfigPath, projectArg, unconfirmedFunctions } from '../arc-deploy.mjs';

const ROOT = resolve(__dirname, '..', '..');
/** The App audience params (CO6), always written with their defaults. */
const APP_USERS_DEFAULTS = 'ARC_APP_USERS_DATABASE=(default)\nARC_APP_USERS_PATH=_arccms_app_users_not_configured/{id}\n';
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
            expect(config).toEqual({ profile: 'standalone', adminOnlySignIn: 'no' });
            expect(configure.validateConfig(config)).toEqual([]);
        });

        it('admin-only sign-in (CO6.6): off for standalone, on for backend, and only written when on', () => {
            expect(configure.normalizeConfig({ profile: 'backend' }).adminOnlySignIn).toBe('yes');
            expect(configure.normalizeConfig({ profile: 'backend', adminOnlySignIn: 'no' }).adminOnlySignIn).toBe('no');
            expect(configure.appValues(config)).toBeNull();
            expect(configure.appValues(configure.normalizeConfig({ adminOnlySignIn: 'yes' }))).toEqual({ adminOnlySignIn: true });
            expect(configure.validateConfig(configure.normalizeConfig({ adminOnlySignIn: 'maybe' })))
                .toContain('admin-only-sign-in must be yes or no, not "maybe".');
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
            expect(configure.updateFunctionsEnv('', config)).toBe(`ARC_DATABASE_ID=(default)\n${APP_USERS_DEFAULTS}`);
            expect(configure.updateFunctionsEnv('RESEND_KEY=x\nARC_DATABASE_ID=old\n', config))
                .toBe(`RESEND_KEY=x\nARC_DATABASE_ID=(default)\n${APP_USERS_DEFAULTS}`);
        });

        it('matches the committed functions/.env, so a fresh clone deploys without running configure', () => {
            const committed = readFileSync(join(ROOT, 'functions/.env'), 'utf8');
            expect(committed).toMatch(/^ARC_DATABASE_ID=\(default\)$/m);
        });

        it('prints no setup commands', () => {
            expect(configure.setupCommands(config)).toEqual([]);
        });
    });

    describe('App audience flags (CO6)', () => {
        it('writes the host collection into the env', () => {
            const c = configure.normalizeConfig({ databaseId: 'arccms', appUsersDatabase: '(default)', appUsersPath: 'users/{uid}' });
            expect(configure.validateConfig(c)).toEqual([]);
            expect(configure.updateFunctionsEnv('', c)).toContain('ARC_APP_USERS_DATABASE=(default)\nARC_APP_USERS_PATH=users/{uid}\n');
        });

        it('accepts only <collection>/{id}', () => {
            expect(configure.validateConfig(configure.normalizeConfig({ databaseId: 'arccms', appUsersPath: 'users' }))).toHaveLength(1);
            expect(configure.validateConfig(configure.normalizeConfig({ databaseId: 'arccms', appUsersPath: 'a/{x}/b/{y}' }))).toHaveLength(1);
        });

        it("accepts ArcCMS's own users as the audience (CO6.8), in either spelling", () => {
            expect(configure.validateConfig(configure.normalizeConfig({ databaseId: 'arccms', appUsersDatabase: 'arccms', appUsersPath: 'users/{id}' }))).toEqual([]);
            expect(configure.validateConfig(configure.normalizeConfig({ databaseId: 'arccms', appUsersDatabase: '(default)', appUsersPath: 'users/{id}' }))).toEqual([]);
        });

        it('--app-users=own points at the install\'s own users, following its database', () => {
            expect(configure.parseFlags(['--app-users=own']).updates).toEqual({ appUsers: 'own' });
            const standalone = configure.normalizeConfig({ appUsers: 'own' });
            expect(standalone).toMatchObject({ appUsersDatabase: '(default)', appUsersPath: 'users/{id}' });
            const named = configure.normalizeConfig({ appUsers: 'own', databaseId: 'arccms', appUsersPath: 'members/{id}' });
            expect(named).toMatchObject({ appUsersDatabase: 'arccms', appUsersPath: 'users/{id}' });
            expect(configure.validateConfig(named)).toEqual([]);
            expect(configure.validateConfig(configure.normalizeConfig({ appUsers: 'mine' })).join(' ')).toMatch(/app-users must be "own"/);
        });

        it('takes hyphenated flags', () => {
            expect(configure.parseFlags(['--app-users-path=users/{uid}']).updates).toEqual({ appUsersPath: 'users/{uid}' });
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
            // The combined core + app rules (scripts/arc-rules-build.mjs), built by the predeploy.
            expect(out.firestore).toEqual([{
                database: 'arccms',
                predeploy: committedFirebase.firestore.predeploy,
                rules: committedFirebase.firestore.rules,
                indexes: committedFirebase.firestore.indexes,
            }]);
            expect(out.storage).toEqual([{
                bucket: 'acme-arccms',
                predeploy: committedFirebase.storage.predeploy,
                rules: committedFirebase.storage.rules,
            }]);
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
                .toBe(`RESEND_KEY=x\nARC_DATABASE_ID=arccms\nARC_HOSTING_SITE=acme-admin\n${APP_USERS_DEFAULTS}ARC_STORAGE_BUCKET=acme-arccms\n`);
        });

        it('--site=none turns hosting off: the env says so, the CLI config gets no site', () => {
            const off = configure.normalizeConfig({ databaseId: 'arccms', hostingSite: 'none' });
            expect(configure.updateFunctionsEnv('', off)).toBe(`ARC_DATABASE_ID=arccms\nARC_HOSTING_SITE=none\n${APP_USERS_DEFAULTS}`);
            expect(configure.renderFirebaseConfig(committedFirebase, off).hosting.site).toBeUndefined();
            expect(configure.renderFirebaseConfig(committedFirebase, configure.normalizeConfig({ hostingSite: 'none' }))).toBeNull();
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
            expect(readFileSync(envFor('acme-prod'), 'utf8')).toBe(`RESEND_KEY=x\nARC_DATABASE_ID=arccms\nARC_HOSTING_SITE=acme-admin\n${APP_USERS_DEFAULTS}ARC_STORAGE_BUCKET=acme-arccms\n`);
            expect(readFileSync(join(dir, 'functions', '.env'), 'utf8')).toBe('ARC_DATABASE_ID=(default)\n');
            expect(readFileSync(paths.install, 'utf8')).toContain('"acme-prod": {');

            // Running again changes nothing.
            log.length = 0;
            expect(run('--project=prod')).toBe(0);
            expect(log).toContain('Nothing to change.');

            // The default project stays default: its env says so and it gets no generated config.
            expect(run()).toBe(0);
            expect(readFileSync(envFor('acme-dev'), 'utf8')).toBe(`ARC_DATABASE_ID=(default)\n${APP_USERS_DEFAULTS}`);
            expect(existsSync(generated('acme-dev'))).toBe(false);

            // Back to standalone for prod: its generated config goes, other env lines stay.
            writeFileSync(paths.config, '{}');
            expect(run('--project=acme-prod')).toBe(0);
            expect(existsSync(generated('acme-prod'))).toBe(false);
            expect(readFileSync(envFor('acme-prod'), 'utf8')).toBe(`RESEND_KEY=x\nARC_DATABASE_ID=(default)\n${APP_USERS_DEFAULTS}`);
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

    it('catches a function the CLI started but never confirmed (a rate-limited update)', () => {
        const output = [
            'i  functions: updating Node.js 22 (2nd Gen) function arccms:arccms-sampleAppUsers(us-central1)...',
            'i  functions: updating Node.js 22 (2nd Gen) function arccms:arccms-testAppUser(us-central1)...',
            'i  functions: creating Node.js 22 (2nd Gen) function onUserCreated(us-central1)...',
            'i  functions: deleting Node.js 22 (2nd Gen) function arccms:arccms-ensureAppUser(us-central1)...',
            '⚠  functions: Request to https://cloudfunctions.googleapis.com/... had HTTP Error: 429, Quota exceeded',
            '✔  functions[arccms:arccms-testAppUser(us-central1)] Successful update operation.',
            '✔  functions[onUserCreated(us-central1)] Successful create operation.',
            '✔  functions[arccms:arccms-ensureAppUser(us-central1)] Successful delete operation.',
        ].join('\n');
        expect(unconfirmedFunctions(output)).toEqual(['arccms-sampleAppUsers(us-central1)']);
    });

    it('is satisfied when every started function succeeded', () => {
        expect(unconfirmedFunctions('i  functions: updating Node.js 22 (2nd Gen) function arccms:arccms-search(us-central1)...\n✔  functions[arccms:arccms-search(us-central1)] Successful update operation.')).toEqual([]);
        expect(unconfirmedFunctions('✔  Deploy complete!')).toEqual([]);
    });
});
