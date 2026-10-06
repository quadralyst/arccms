/** runAdminScript: the one place a command-line script gets its project, database and credentials. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { findCredentials, resolveTarget, runAdminScript, storageBucketFor } from '../arc-admin-script.mjs';

describe('arc-admin-script', () => {
    let root: string;
    let home: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'arc-admin-root-'));
        home = mkdtempSync(join(tmpdir(), 'arc-admin-home-'));
        writeFileSync(join(root, '.firebaserc'), JSON.stringify({ projects: { default: 'dev-project', production: 'live-project' } }));
        mkdirSync(join(root, 'functions'));
        writeFileSync(join(root, 'functions', '.env.dev-project'), 'ARC_DATABASE_ID=arccms\n');
        mkdirSync(join(root, 'src', 'environments'), { recursive: true });
        writeFileSync(join(root, 'src', 'environments', 'environment.ts'), "projectId: 'dev-project',\nstorageBucket: 'dev-project.firebasestorage.app',\n");
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
        process.exitCode = undefined;
    });

    const login = () => {
        mkdirSync(join(home, '.config', 'configstore'), { recursive: true });
        writeFileSync(join(home, '.config', 'configstore', 'firebase-tools.json'), JSON.stringify({ tokens: { refresh_token: 'refresh' } }));
    };

    describe('resolveTarget', () => {
        it('uses the default alias and passes other arguments on', () => {
            expect(resolveTarget(['words.csv', '--dry-run'], root, {})).toEqual({ projectId: 'dev-project', prod: false, args: ['words.csv', '--dry-run'] });
        });

        it('uses the production alias with --prod', () => {
            expect(resolveTarget(['--prod'], root, {})).toMatchObject({ projectId: 'live-project', prod: true, args: [] });
        });

        it('takes an alias or a project id with --project', () => {
            expect(resolveTarget(['--project=production'], root, {}).projectId).toBe('live-project');
            expect(resolveTarget(['--project=other-id'], root, {}).projectId).toBe('other-id');
        });

        it('lets GCLOUD_PROJECT replace the default, but not a flag', () => {
            expect(resolveTarget([], root, { GCLOUD_PROJECT: 'shell-project' }).projectId).toBe('shell-project');
            expect(resolveTarget(['--prod'], root, { GCLOUD_PROJECT: 'shell-project' }).projectId).toBe('live-project');
        });

        it('says how to add a missing alias', () => {
            writeFileSync(join(root, '.firebaserc'), JSON.stringify({ projects: { default: 'dev-project' } }));
            expect(() => resolveTarget(['--prod'], root, {})).toThrow('firebase use --add');
        });
    });

    describe('findCredentials', () => {
        it('prefers GOOGLE_APPLICATION_CREDENTIALS', () => {
            login();
            expect(findCredentials({ GOOGLE_APPLICATION_CREDENTIALS: '/key.json' }, home)).toEqual({ label: 'GOOGLE_APPLICATION_CREDENTIALS', refreshToken: null });
        });

        it('falls back to the Firebase CLI login', () => {
            login();
            expect(findCredentials({}, home).refreshToken).toBe('refresh');
        });

        it('says to log in when there is neither', () => {
            expect(() => findCredentials({}, home)).toThrow('firebase login');
        });
    });

    it("finds the project's storage bucket in its environment file", () => {
        expect(storageBucketFor('dev-project', root)).toBe('dev-project.firebasestorage.app');
        expect(storageBucketFor('live-project', root)).toBeUndefined();
    });

    it('reads a project\'s generated web settings first (specs/app-project-settings-spec.md)', () => {
        writeFileSync(join(root, 'src', 'environments', 'firebase-web.live-project.ts'),
            'export const environment = {\n    firebaseConfig: {\n        projectId: "live-project",\n        storageBucket: "live-project.firebasestorage.app",\n    },\n};\n');
        expect(storageBucketFor('live-project', root)).toBe('live-project.firebasestorage.app');
    });

    it('calls a project marked "production": "yes" production, as well as the production alias', () => {
        writeFileSync(join(root, 'arccms.config.json'), JSON.stringify({ projects: { 'shop-main': { production: 'yes' } } }));
        expect(resolveTarget(['--project=shop-main'], root, {}).prod).toBe(true);
        expect(resolveTarget([], root, {}).prod).toBe(false);
    });

    describe('runAdminScript', () => {
        const quiet = { log: () => {}, error: () => {} };

        it("runs the script against the install's database with temporary credentials, then deletes them", async () => {
            login();
            const env: Record<string, string | undefined> = {};
            let seen: { credentials?: string; contents?: string } = {};
            const result = await runAdminScript(async (ctx: { projectId: string; databaseId: string; args: string[] }) => {
                seen = { credentials: env.GOOGLE_APPLICATION_CREDENTIALS, contents: readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS!, 'utf8') };
                return [ctx.projectId, ctx.databaseId, ctx.args];
            }, { argv: ['words.csv'], root, env, home, ...quiet });

            expect(result).toEqual(['dev-project', 'arccms', ['words.csv']]);
            expect(JSON.parse(seen.contents!)).toMatchObject({ type: 'authorized_user', refresh_token: 'refresh' });
            expect(existsSync(seen.credentials!)).toBe(false);
            expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
            expect(env.GCLOUD_PROJECT).toBe('dev-project');
            expect(JSON.parse(env.FIREBASE_CONFIG!)).toEqual({ projectId: 'dev-project', storageBucket: 'dev-project.firebasestorage.app' });
        });

        it('deletes the credentials when the script fails, and exits with 1', async () => {
            login();
            const env: Record<string, string | undefined> = {};
            const errors: string[] = [];
            let file = '';
            const result = await runAdminScript(async () => {
                file = env.GOOGLE_APPLICATION_CREDENTIALS!;
                throw new Error('bad row 12');
            }, { argv: [], root, env, home, log: () => {}, error: (line: string) => errors.push(line) });

            expect(result).toBeUndefined();
            expect(existsSync(file)).toBe(false);
            expect(errors.join('\n')).toContain('bad row 12');
            expect(process.exitCode).toBe(1);
        });

        it('prints the project and database before the script runs', async () => {
            login();
            const lines: string[] = [];
            await runAdminScript(async () => lines.push('script'), { argv: ['--prod'], root, env: {}, home, log: (l: string) => lines.push(l), error: () => {} });
            expect(lines.join('\n')).toMatch(/live-project \(production\)[\s\S]*\(default\)[\s\S]*Firebase CLI login[\s\S]*script/);
        });

        it('does not run the script without credentials', async () => {
            let ran = false;
            await runAdminScript(async () => { ran = true; }, { argv: [], root, env: {}, home, ...quiet });
            expect(ran).toBe(false);
            expect(process.exitCode).toBe(1);
        });
    });

    it('is what the static page seed uses, so credential handling lives in one place', () => {
        const seed = readFileSync(join(__dirname, '..', '..', 'functions', 'scripts', 'call-seed.cjs'), 'utf8');
        expect(seed).toContain('runAdminScript');
        expect(seed).not.toContain('refresh_token');
    });
});
