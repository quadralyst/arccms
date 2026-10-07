/**
 * The scripts that read the real functions build outside Firebase: the deletion
 * check of a full deploy (arc-deploy), the deploy menu and arc:upgrade. Firebase
 * sets GCLOUD_PROJECT when it loads the build; these scripts run without it, and
 * a first generation function (onSignInDeleted, an Auth trigger) throws when its
 * `__endpoint` is read then. So this builds the functions and reads them with
 * GCLOUD_PROJECT unset, as a shell does.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { builtArccms, callableNames } from '../arc-built-functions.mjs';
import { builtCallables, checkTarget } from '../arc-callables.mjs';
import { functionIds, probeFailureMessage } from '../arc-deploy.mjs';
import { deployableNames } from '../arc-deploy-menu.mjs';
import { exportedFunctionNames } from '../arc-upgrade.mjs';

const ROOT = resolve(__dirname, '../..');

describe('the real functions build, read without GCLOUD_PROJECT', () => {
    const saved = process.env['GCLOUD_PROJECT'];
    let arccms: Record<string, unknown>;
    let features: Record<string, unknown>[];

    beforeAll(async () => {
        const build = spawnSync('npm', ['run', 'build', '--prefix', resolve(ROOT, 'functions')], {
            encoding: 'utf8', shell: process.platform === 'win32',
        });
        if (build.status !== 0) throw new Error(`The functions build failed:\n${build.stdout}\n${build.stderr}`);
        delete process.env['GCLOUD_PROJECT'];
        arccms = await builtArccms();
        const dir = resolve(ROOT, 'functions/lib/features');
        features = await Promise.all(readdirSync(dir).filter((f) => f.endsWith('.js'))
            .map((f) => import(pathToFileURL(resolve(dir, f)).href)));
    }, 300_000);

    afterAll(() => {
        if (saved === undefined) delete process.env['GCLOUD_PROJECT'];
        else process.env['GCLOUD_PROJECT'] = saved;
    });

    it('a full deploy lists the built functions, the first generation one included', () => {
        const ids: string[] = functionIds(arccms);
        expect(ids).toContain('arccms-onSignInDeleted');
        expect(ids).toContain('arccms-onUserDeleted');
    });

    it('the deploy menu offers them', () => {
        expect(deployableNames(arccms)).toContain('onSignInDeleted');
    });

    it('arc:upgrade names them, turned-off features included', () => {
        expect(exportedFunctionNames([arccms, ...features])).toContain('onSignInDeleted');
    });

    it('the callable check lists the second generation callables, and never the first generation trigger', () => {
        const names: string[] = callableNames(arccms);
        expect(names).toContain('claimFirstAdmin');
        expect(names).not.toContain('onSignInDeleted');
        expect(names).not.toContain('onUserDeleted');
    });

    it('the callable check script reads the build and checks the project and region it is given', () => {
        const dir = mkdtempSync(join(tmpdir(), 'arc-callables-'));
        try {
            // A stand-in curl: every callable answers as a working one does, and each URL is logged.
            const log = join(dir, 'urls.log');
            writeFileSync(join(dir, 'curl'), `#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in https://*) echo "$a" >> ${JSON.stringify(log)};; esac; done\nprintf '{"result":{}}\\n200'\n`);
            chmodSync(join(dir, 'curl'), 0o755);
            const { GCLOUD_PROJECT: _unset, ...env } = process.env;
            const run = spawnSync('bash', [resolve(ROOT, 'functions/scripts/check-callable-access.sh')], {
                encoding: 'utf8', env: { ...env, PATH: `${dir}:${env['PATH']}`, FIREBASE_PROJECT: 'demo-app', FIREBASE_REGION: 'europe-west6' },
            });
            expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
            expect(run.stdout).toContain('All callables reachable.');
            const urls = readFileSync(log, 'utf8').trim().split('\n');
            expect(urls).toContain('https://europe-west6-demo-app.cloudfunctions.net/arccms-claimFirstAdmin');
            expect(urls.every((url) => url.startsWith('https://europe-west6-demo-app.cloudfunctions.net/'))).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);
});

describe('the callable check, when it cannot check', () => {
    it('says why when the build cannot be read, and claims nothing is blocked', async () => {
        const result = await builtCallables(async () => { throw new Error('process.env.GCLOUD_PROJECT is not set.'); });
        expect(result.error).toContain('Could not read the functions build');
        expect(probeFailureMessage(2)).toContain('could not run, so the callables were not checked');
        expect(probeFailureMessage(2)).not.toContain('blocked');
        expect(probeFailureMessage(1)).toContain('blocked');
    });

    it('defaults to the project a deploy would go to and that project\'s region, never a fixed one', () => {
        const deps = { aliases: { dev: 'acme-dev' }, project: () => 'acme-dev', region: (id: string) => (id === 'acme-dev' ? 'europe-west6' : 'x') };
        expect(checkTarget({}, deps)).toEqual({ projectId: 'acme-dev', region: 'europe-west6' });
        expect(checkTarget({ FIREBASE_PROJECT: 'dev' }, deps)).toEqual({ projectId: 'acme-dev', region: 'europe-west6' });
        expect(checkTarget({ FIREBASE_PROJECT: 'dev', FIREBASE_REGION: 'asia-south1' }, deps)).toEqual({ projectId: 'acme-dev', region: 'asia-south1' });
        expect(checkTarget({}, { ...deps, project: () => '' }).error).toContain('No Firebase project to check');
        expect(readFileSync(resolve(ROOT, 'functions/scripts/check-callable-access.sh'), 'utf8')).not.toMatch(/xlm-project-864ff|:-us-central1/);
    });
});
