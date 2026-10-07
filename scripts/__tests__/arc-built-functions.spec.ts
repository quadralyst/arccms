/**
 * The scripts that read the real functions build outside Firebase: the deletion
 * check of a full deploy (arc-deploy), the deploy menu and arc:upgrade. Firebase
 * sets GCLOUD_PROJECT when it loads the build; these scripts run without it, and
 * a first generation function (onSignInDeleted, an Auth trigger) throws when its
 * `__endpoint` is read then. So this builds the functions and reads them with
 * GCLOUD_PROJECT unset, as a shell does.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { builtArccms } from '../arc-built-functions.mjs';
import { functionIds } from '../arc-deploy.mjs';
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
});
