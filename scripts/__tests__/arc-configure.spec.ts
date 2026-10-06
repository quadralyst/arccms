import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import * as configure from '../arc-configure.mjs';
// @ts-expect-error: plain ESM script without type declarations
import {
    cliActiveProject, deployArgs, deployProject, deploysFunctions, deploysOnlyFunctions, namesHosting, namesTarget, generatedConfigPath, projectArg, retryArgs, retryTargets, unconfirmed, unconfirmedFunctions,
} from '../arc-deploy.mjs';

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

        it('offline cache (docs/app/offline.html): off by default, validated, written only when on, never to the functions', () => {
            expect(configure.parseFlags(['--offline-cache=multi-tab']).updates).toEqual({ offlineCache: 'multi-tab' });
            expect(configure.appValues(configure.normalizeConfig({ offlineCache: 'off' }))).toBeNull();
            expect(configure.appValues(configure.normalizeConfig({ offlineCache: 'single-tab' }))).toEqual({ offlineCache: 'single-tab' });
            expect(configure.appValues(configure.normalizeConfig({ offlineCache: 'multi-tab' }))).toEqual({ offlineCache: 'multi-tab' });
            expect(configure.validateConfig(configure.normalizeConfig({ offlineCache: 'always' })))
                .toContain('offline-cache must be one of off, single-tab, multi-tab, not "always".');
            expect(configure.validateConfig(configure.normalizeConfig({ offlineCache: 'multi-tab' }))).toEqual([]);
            expect(configure.updateFunctionsEnv('', configure.normalizeConfig({ offlineCache: 'multi-tab' }))).not.toMatch(/OFFLINE/i);
            expect(configure.renderArcInstall({ 'p-1': configure.normalizeConfig({ offlineCache: 'multi-tab' }) }))
                .toContain('offlineCache: "multi-tab"');
        });

        it('analytics consent (docs/features/analytics.html): always by default, validated, written only when required, never to the functions', () => {
            expect(configure.parseFlags(['--analytics-consent=required']).updates).toEqual({ analyticsConsent: 'required' });
            expect(configure.appValues(configure.normalizeConfig({ analyticsConsent: 'always' }))).toBeNull();
            expect(configure.appValues(configure.normalizeConfig({ analyticsConsent: 'required' }))).toEqual({ analyticsConsent: 'required' });
            expect(configure.validateConfig(configure.normalizeConfig({ analyticsConsent: 'never' })))
                .toContain('analytics-consent must be one of always, required, not "never".');
            expect(configure.updateFunctionsEnv('', configure.normalizeConfig({ analyticsConsent: 'required' }))).not.toMatch(/ANALYTICS/i);
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
            expect(configure.updateFunctionsEnv('', config)).toBe(`ARC_DATABASE_ID=(default)\nARC_FUNCTIONS_REGION=us-central1\n${APP_USERS_DEFAULTS}`);
            expect(configure.updateFunctionsEnv('RESEND_KEY=x\nARC_DATABASE_ID=old\n', config))
                .toBe(`RESEND_KEY=x\nARC_DATABASE_ID=(default)\nARC_FUNCTIONS_REGION=us-central1\n${APP_USERS_DEFAULTS}`);
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

        it('takes an upload folder only as one folder ending in a slash (review F)', () => {
            const errors = (prefix: string) => configure.validateConfig(configure.normalizeConfig({ storagePrefix: prefix }));
            expect(errors('arccms/')).toEqual([]);
            expect(errors('arccms')).toHaveLength(1);
            expect(errors('sites/arccms/')).toHaveLength(1);
            expect(errors('../x/')).toHaveLength(1);
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

        it('tells the app its hosting site, or that it has none, so the admin can compare site files with it', () => {
            expect(configure.appValues(config).hostingSite).toBe('acme-admin');
            expect(configure.appValues(configure.normalizeConfig({ hostingSite: 'none' }))).toEqual({ hostingSite: 'none' });
        });

        it('sets the ARC_* keys in functions/.env, replacing old values', () => {
            expect(configure.updateFunctionsEnv('RESEND_KEY=x\nARC_DATABASE_ID=old\n', config))
                .toBe(`RESEND_KEY=x\nARC_DATABASE_ID=arccms\nARC_FUNCTIONS_REGION=us-central1\nARC_HOSTING_SITE=acme-admin\n${APP_USERS_DEFAULTS}ARC_STORAGE_BUCKET=acme-arccms\n`);
        });

        it('--site=none turns hosting off: the env says so, and the CLI config has no hosting to deploy (review O2)', () => {
            const off = configure.normalizeConfig({ databaseId: 'arccms', hostingSite: 'none' });
            expect(configure.updateFunctionsEnv('', off)).toBe(`ARC_DATABASE_ID=arccms\nARC_FUNCTIONS_REGION=us-central1\nARC_HOSTING_SITE=none\n${APP_USERS_DEFAULTS}`);
            const out = configure.renderFirebaseConfig(committedFirebase, off);
            expect(out).not.toHaveProperty('hosting');
            // Everything else is still deployed as before.
            expect(out.functions).toEqual(committedFirebase.functions);
            expect(out.firestore[0].database).toBe('arccms');
        });

        it('hosting off alone still gets a generated config, or firebase.json would deploy hosting (review O2)', () => {
            const out = configure.renderFirebaseConfig(committedFirebase, configure.normalizeConfig({ hostingSite: 'none' }));
            expect(out).not.toBeNull();
            expect(out).not.toHaveProperty('hosting');
            expect(committedFirebase).toHaveProperty('hosting');
        });

        it("deploys no storage rules into another app's bucket, only into its own (review F)", () => {
            const shared = configure.normalizeConfig({ databaseId: 'arccms', storagePrefix: 'arccms/', hostingSite: 'none' });
            expect(configure.sharesDefaultBucket(shared)).toBe(true);
            expect(configure.renderFirebaseConfig(committedFirebase, shared)).not.toHaveProperty('storage');

            const own = configure.normalizeConfig({ databaseId: 'arccms', storageBucket: 'acme-arccms', hostingSite: 'none' });
            expect(configure.sharesDefaultBucket(own)).toBe(false);
            expect(configure.renderFirebaseConfig(committedFirebase, own).storage[0].bucket).toBe('acme-arccms');

            // A standalone install owns the default bucket, upload folder or not.
            expect(configure.sharesDefaultBucket(configure.normalizeConfig({ storagePrefix: 'arccms/' }))).toBe(false);
        });

        it('prints the commands that create the resources', () => {
            const commands = configure.setupCommands({ ...config, region: 'nam5' }).join('\n');
            expect(commands).toContain('firebase firestore:databases:create arccms --location=nam5');
            expect(commands).toContain('firebase hosting:sites:create acme-admin');
            expect(commands).toContain('gs://acme-arccms');
        });
    });

    describe('web settings per project (specs/app-project-settings-spec.md)', () => {
        const web = { apiKey: 'k', authDomain: 'acme-staging.firebaseapp.com', projectId: 'acme-staging', appId: '1:2:web:3', storageBucket: 'acme-staging.appspot.com' };

        it('keeps the web settings object and the production marker through normalizing', () => {
            const config = configure.normalizeConfig({ firebaseConfig: { ...web, extra: 'dropped', locationId: 'x' }, production: 'yes' });
            expect(config.firebaseConfig).toEqual(web);
            expect(config.production).toBe('yes');
            expect(configure.parseFlags(['--production=yes', '--web-config=fetch', '--web-app=1:2:web:3']))
                .toEqual({ updates: { production: 'yes' }, dryRun: false, project: '', webConfig: 'fetch', webApp: '1:2:web:3' });
        });

        it('refuses settings for another project, incomplete settings and a bad production value', () => {
            expect(configure.validateConfig(configure.normalizeConfig({ firebaseConfig: web }), 'acme-prod'))
                .toContain('firebaseConfig is for acme-staging, not acme-prod: a site built with it would talk to the wrong project.');
            expect(configure.validateConfig(configure.normalizeConfig({ firebaseConfig: { apiKey: 'k', projectId: 'acme-staging' } }), 'acme-staging'))
                .toContain('firebaseConfig is missing authDomain, appId.');
            expect(configure.validateConfig(configure.normalizeConfig({ production: 'maybe' })))
                .toContain('production must be yes or no, not "maybe".');
            expect(configure.validateConfig(configure.normalizeConfig({ firebaseConfig: web, production: 'no' }), 'acme-staging')).toEqual([]);
        });

        it('reads a JSON file or the Firebase console snippet', () => {
            expect(configure.parseWebConfigText(JSON.stringify(web))).toEqual(web);
            const snippet = `// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "k",
  authDomain: 'acme-staging.firebaseapp.com',
  projectId: "acme-staging",
  storageBucket: "acme-staging.appspot.com",
  appId: "1:2:web:3",
};`;
            expect(configure.parseWebConfigText(snippet)).toEqual(web);
            expect(() => configure.parseWebConfigText('nothing here')).toThrow('No { ... }');
        });

        it('renders the generated file in the shape of environment.ts, only when there are settings', () => {
            const text = configure.renderWebConfig(configure.normalizeConfig({ firebaseConfig: web, production: 'yes' }));
            expect(text.startsWith(configure.WEB_CONFIG_HEADER)).toBe(true);
            expect(text).toContain('export const environment = {');
            expect(text).toContain('production: true,');
            expect(text).toContain('projectId: "acme-staging",');
            expect(configure.renderWebConfig(configure.normalizeConfig({}))).toBeNull();
        });

        describe('fetching with the Firebase CLI', () => {
            const answer = (result: unknown, status = 'success') => ({ stdout: JSON.stringify(status === 'success' ? { status, result } : { status, error: result }) });
            const sdk = { ...web, locationId: 'eur3', projectNumber: '2', version: '2' };

            it('takes the only web app', () => {
                const run = vi.fn((_cmd: string, args: string[]) => args[0] === 'apps:list'
                    ? answer([{ appId: '1:2:web:3', state: 'ACTIVE' }])
                    : answer({ sdkConfig: sdk }));
                expect(configure.fetchWebConfig('acme-staging', { run })).toEqual(web);
                expect(run.mock.calls[1][1]).toEqual(['apps:sdkconfig', 'WEB', '1:2:web:3', '--project', 'acme-staging', '--json', '--non-interactive']);
            });

            it('with several apps, takes the one an environment file names, else asks for --web-app', () => {
                const apps = [{ appId: 'a', displayName: 'Admin', state: 'ACTIVE' }, { appId: 'b', displayName: 'Shop', state: 'ACTIVE' }];
                const run = vi.fn((_cmd: string, args: string[]) => args[0] === 'apps:list' ? answer(apps) : answer({ sdkConfig: sdk }));
                configure.fetchWebConfig('acme-staging', { run, knownAppIds: ['b'] });
                expect(run.mock.calls[1][1][2]).toBe('b');
                expect(() => configure.fetchWebConfig('acme-staging', { run, knownAppIds: [] }))
                    .toThrow(/2 web apps\. Choose one with --web-app=<appId>:\n {2}a {2}Admin\n {2}b {2}Shop/);
            });

            it('skips the list when the app is given, and says what the CLI said when it fails', () => {
                const run = vi.fn(() => answer({ sdkConfig: sdk }));
                configure.fetchWebConfig('acme-staging', { run, appId: 'x' });
                expect(run).toHaveBeenCalledTimes(1);
                expect(() => configure.fetchWebConfig('acme-staging', { run: () => answer('Permission denied', 'error') }))
                    .toThrow('Firebase CLI: Permission denied');
                expect(() => configure.fetchWebConfig('acme-staging', { run: () => ({ stdout: '', stderr: 'command not found' }) }))
                    .toThrow('The Firebase CLI did not answer (command not found).');
            });
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

        it('writes a project\'s web settings to its own file, and removes the file when they go', () => {
            mkdirSync(join(dir, 'src', 'environments'), { recursive: true });
            const web = { apiKey: 'k', authDomain: 'acme-prod.firebaseapp.com', projectId: 'acme-prod', appId: '1:2:web:3' };
            writeFileSync(join(dir, 'web.json'), JSON.stringify(web));
            const file = join(dir, 'src', 'environments', 'firebase-web.acme-prod.ts');

            expect(run('--project=prod', '--web-config=web.json', '--production=yes')).toBe(0);
            expect(readFileSync(file, 'utf8')).toContain('projectId: "acme-prod",');
            expect(readFileSync(file, 'utf8')).toContain('production: true,');
            expect(JSON.parse(readFileSync(paths.config, 'utf8')).projects['acme-prod']).toEqual({ firebaseConfig: web, production: 'yes' });
            // The install map stays free of web settings.
            expect(existsSync(paths.install) ? readFileSync(paths.install, 'utf8') : '').not.toContain('apiKey');

            const stored = JSON.parse(readFileSync(paths.config, 'utf8'));
            delete stored.projects['acme-prod'].firebaseConfig;
            writeFileSync(paths.config, JSON.stringify(stored));
            expect(run('--project=prod')).toBe(0);
            expect(existsSync(file)).toBe(false);
        });

        it('refuses web settings for another project, writing nothing', () => {
            mkdirSync(join(dir, 'src', 'environments'), { recursive: true });
            writeFileSync(join(dir, 'web.json'), JSON.stringify({ apiKey: 'k', authDomain: 'x', projectId: 'someone-else', appId: 'a' }));
            expect(run('--project=prod', '--web-config=web.json')).toBe(1);
            expect(log.join('\n')).toContain('firebaseConfig is for someone-else, not acme-prod');
            expect(existsSync(join(dir, 'src', 'environments', 'firebase-web.acme-prod.ts'))).toBe(false);
        });

        it('configures one project from flags, leaving the others and the shared .env alone', () => {
            expect(run('--project=prod', '--profile=backend', '--database=arccms', '--site=acme-admin', '--bucket=acme-arccms')).toBe(0);

            expect(JSON.parse(readFileSync(paths.config, 'utf8'))).toEqual({ projects: { 'acme-prod': backend } });
            expect(existsSync(generated('acme-prod'))).toBe(true);
            expect(existsSync(generated('acme-dev'))).toBe(false);
            expect(readFileSync(envFor('acme-prod'), 'utf8')).toBe(`RESEND_KEY=x\nARC_DATABASE_ID=arccms\nARC_FUNCTIONS_REGION=us-central1\nARC_HOSTING_SITE=acme-admin\n${APP_USERS_DEFAULTS}ARC_STORAGE_BUCKET=acme-arccms\n`);
            expect(readFileSync(join(dir, 'functions', '.env'), 'utf8')).toBe('ARC_DATABASE_ID=(default)\n');
            expect(readFileSync(paths.install, 'utf8')).toContain('"acme-prod": {');

            // Running again changes nothing.
            log.length = 0;
            expect(run('--project=prod')).toBe(0);
            expect(log).toContain('Nothing to change.');

            // The default project stays default: its env says so and it gets no generated config.
            expect(run()).toBe(0);
            expect(readFileSync(envFor('acme-dev'), 'utf8')).toBe(`ARC_DATABASE_ID=(default)\nARC_FUNCTIONS_REGION=us-central1\n${APP_USERS_DEFAULTS}`);
            expect(existsSync(generated('acme-dev'))).toBe(false);

            // Back to standalone for prod: its generated config goes, other env lines stay.
            writeFileSync(paths.config, '{}');
            expect(run('--project=acme-prod')).toBe(0);
            expect(existsSync(generated('acme-prod'))).toBe(false);
            expect(readFileSync(envFor('acme-prod'), 'utf8')).toBe(`RESEND_KEY=x\nARC_DATABASE_ID=(default)\nARC_FUNCTIONS_REGION=us-central1\n${APP_USERS_DEFAULTS}`);
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

    it("adds the target project's generated config when there is one, and always names the project (review O4)", () => {
        expect(deployArgs(['--only', 'functions'], true, 'acme-prod', ROOT))
            .toEqual(['deploy', '--config', 'firebase.acme-prod.json', '--only', 'functions', '--project', 'acme-prod']);
        expect(deployArgs(['--only', 'functions'], false, 'acme-prod'))
            .toEqual(['deploy', '--only', 'functions', '--project', 'acme-prod']);
        expect(generatedConfigPath('acme-prod')).toBe(join(ROOT, 'firebase.acme-prod.json'));
    });

    it('leaves an explicit --config alone and never passes --probe or --no-probe to firebase', () => {
        expect(deployArgs(['--config', 'other.json', '--no-probe'], true, 'acme-prod')).toEqual(['deploy', '--config', 'other.json', '--project', 'acme-prod']);
        expect(deployArgs(['--probe', '--only', 'functions', '-P', 'prod'], false, 'acme-prod')).toEqual(['deploy', '--only', 'functions', '-P', 'prod']);
    });

    it('targets the project the CLI would: --project, else firebase use, else the default alias (review O4)', () => {
        const aliases = { default: 'acme-dev', production: 'acme-prod' };
        const active = (id: string) => () => id;
        expect(deployProject(['--project', 'production'], aliases, active('acme-dev'))).toBe('acme-prod');
        expect(deployProject(['--only', 'functions'], aliases, active('acme-prod'))).toBe('acme-prod');
        expect(deployProject([], aliases, active(''))).toBe('acme-dev');
        expect(deployProject(['--project=some-id'], aliases, active('acme-prod'))).toBe('some-id');
    });

    it("reads the CLI's active project, and nothing when it cannot", () => {
        const run = (stdout: string) => (() => ({ stdout })) as any;
        expect(cliActiveProject(run('{"status":"success","result":"acme-prod"}'))).toBe('acme-prod');
        expect(cliActiveProject(run('{"status":"error","error":"No active project"}'))).toBe('');
        expect(cliActiveProject(run('not json'))).toBe('');
    });

    it('finds the project in every form the CLI accepts', () => {
        expect(projectArg(['--project', 'prod'])).toBe('prod');
        expect(projectArg(['--project=prod'])).toBe('prod');
        expect(projectArg(['-P', 'prod'])).toBe('prod');
        expect(projectArg(['--only', 'functions'])).toBe('');
    });

    it('knows when a deploy names storage, to refuse it in a shared bucket (review F)', () => {
        expect(namesTarget(['--only', 'functions:arccms,firestore,storage'], 'storage')).toBe(true);
        expect(namesTarget(['--only=storage'], 'storage')).toBe(true);
        expect(namesTarget(['--only', 'firestore'], 'storage')).toBe(false);
    });

    it('knows when a deploy names hosting, to refuse it where hosting is off (review O2)', () => {
        expect(namesHosting(['--only', 'hosting'])).toBe(true);
        expect(namesHosting(['--only=functions,hosting:site'])).toBe(true);
        expect(namesHosting(['--only', 'functions'])).toBe(false);
        expect(namesHosting([])).toBe(false);
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

    describe('retrying functions that never reported success', () => {
        const output = [
            'i  functions: updating Node.js 22 (2nd Gen) function arccms:arccms-reindexSearch(us-central1)...',
            '\x1b[33mi  functions: updating Node.js 22 (2nd Gen) function arccms:arccms-custom-hello(us-central1)...\x1b[39m',
            'i  functions: creating Node.js 22 (2nd Gen) function onUserCreated(us-central1)...',
            'i  functions: deleting Node.js 22 (2nd Gen) function arccms:arccms-oldThing(us-central1)...',
            '⚠  functions:  failed to update function projects/p/locations/us-central1/functions/arccms-reindexSearch',
        ].join('\n');

        it('keeps the codebase, knows deletes, and reads coloured output', () => {
            expect(unconfirmed(output)).toEqual([
                { codebase: 'arccms', name: 'arccms-custom-hello', region: 'us-central1', deleting: false },
                { codebase: 'arccms', name: 'arccms-oldThing', region: 'us-central1', deleting: true },
                { codebase: 'arccms', name: 'arccms-reindexSearch', region: 'us-central1', deleting: false },
                { codebase: '', name: 'onUserCreated', region: 'us-central1', deleting: false },
            ]);
        });

        it('redeploys creates and updates by their group path, never a delete', () => {
            expect(retryTargets(unconfirmed(output))).toEqual([
                'functions:arccms:arccms.custom.hello',
                'functions:arccms:arccms.reindexSearch',
                'functions:onUserCreated',
            ]);
        });

        it('replaces --only and keeps every other argument', () => {
            const targets = ['functions:arccms:arccms.reindexSearch'];
            expect(retryArgs(['deploy', '--config', 'firebase.p.json', '--only', 'functions:arccms', '--project', 'default'], targets))
                .toEqual(['deploy', '--config', 'firebase.p.json', '--project', 'default', '--only', 'functions:arccms:arccms.reindexSearch']);
            expect(retryArgs(['deploy', '--only=functions,firestore:rules'], targets))
                .toEqual(['deploy', '--only', 'functions:arccms:arccms.reindexSearch']);
            expect(retryArgs(['deploy', '--project', 'default'], targets))
                .toEqual(['deploy', '--project', 'default', '--only', 'functions:arccms:arccms.reindexSearch']);
        });

        it('lets a clean retry clear the failure only for a functions-only deploy', () => {
            expect(deploysOnlyFunctions(['--only', 'functions:arccms'])).toBe(true);
            expect(deploysOnlyFunctions(['--only=functions:arccms:arccms.a,functions:arccms:arccms.b'])).toBe(true);
            expect(deploysOnlyFunctions(['--only', 'functions,firestore:rules'])).toBe(false);
            expect(deploysOnlyFunctions([])).toBe(false);
        });
    });
});
