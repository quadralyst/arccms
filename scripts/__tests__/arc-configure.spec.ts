import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import * as configure from '../arc-configure.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { deployArgs, GENERATED_CONFIG } from '../arc-deploy.mjs';

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

        it('renders an empty arc-install.ts', () => {
            expect(configure.renderArcInstall(config)).toContain('export const arcInstall: ArcInstallConfig = {};');
        });

        it('writes no ARC_* keys and keeps other functions/.env lines', () => {
            expect(configure.updateFunctionsEnv('', config)).toBe('');
            expect(configure.updateFunctionsEnv('RESEND_KEY=x\nARC_DATABASE_ID=old\n', config)).toBe('RESEND_KEY=x\n');
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

        it('writes the app values into arc-install.ts', () => {
            const rendered = configure.renderArcInstall({ ...config, storagePrefix: 'arccms/' });
            expect(rendered).toContain('databaseId: "arccms"');
            expect(rendered).toContain('storageBucket: "acme-arccms"');
            expect(rendered).toContain('storagePrefix: "arccms/"');
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

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'arc-configure-'));
            paths = {
                config: join(dir, 'arccms.config.json'),
                firebase: join(dir, 'firebase.json'),
                generatedFirebase: join(dir, 'firebase.arccms.json'),
                install: join(dir, 'arc-install.ts'),
                functionsEnv: join(dir, '.env'),
            };
            writeFileSync(paths.firebase, JSON.stringify(committedFirebase));
            writeFileSync(paths.functionsEnv, 'RESEND_KEY=x\n');
            log.length = 0;
        });
        afterEach(() => rmSync(dir, { recursive: true, force: true }));

        const run = (...args: string[]) => configure.main(args, paths, (line: string) => log.push(line));

        it('configures a backend install from flags, then returns to defaults', () => {
            expect(run('--profile=backend', '--database=arccms', '--site=acme-admin', '--bucket=acme-arccms')).toBe(0);
            expect(JSON.parse(readFileSync(paths.config, 'utf8'))).toEqual(backend);
            expect(existsSync(paths.generatedFirebase)).toBe(true);
            expect(readFileSync(paths.functionsEnv, 'utf8')).toContain('ARC_DATABASE_ID=arccms');

            // Running again with the same config changes nothing.
            expect(run()).toBe(0);
            expect(log.at(-1)).not.toMatch(/^(create|update|remove)/m);

            // Back to standalone: the generated config goes, other env lines stay.
            writeFileSync(paths.config, '{}');
            expect(run()).toBe(0);
            expect(existsSync(paths.generatedFirebase)).toBe(false);
            expect(readFileSync(paths.functionsEnv, 'utf8')).toBe('RESEND_KEY=x\n');
        });

        it('refuses an unsafe config and writes nothing', () => {
            expect(run('--profile=backend')).toBe(1);
            expect(existsSync(paths.config)).toBe(false);
            expect(existsSync(paths.install)).toBe(false);
        });

        it('--dry-run writes nothing', () => {
            expect(run('--profile=backend', '--database=arccms', '--site=a-site', '--bucket=a-bucket', '--dry-run')).toBe(0);
            expect(existsSync(paths.config)).toBe(false);
            expect(existsSync(paths.generatedFirebase)).toBe(false);
            expect(log.join('\n')).toMatch(/Would create/);
        });
    });
});

describe('arc-deploy', () => {
    it('is plain firebase deploy without a generated config', () => {
        expect(deployArgs(['--only', 'functions'], false)).toEqual(['deploy', '--only', 'functions']);
    });

    it('adds the generated config when there is one', () => {
        expect(deployArgs(['--only', 'functions'], true, ROOT))
            .toEqual(['deploy', '--config', 'firebase.arccms.json', '--only', 'functions']);
        expect(GENERATED_CONFIG).toBe(join(ROOT, 'firebase.arccms.json'));
    });

    it('leaves an explicit --config alone', () => {
        expect(deployArgs(['--config', 'other.json'], true)).toEqual(['deploy', '--config', 'other.json']);
    });
});
