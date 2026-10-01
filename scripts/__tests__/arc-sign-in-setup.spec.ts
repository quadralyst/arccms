import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { checkSignInSetup, grantsTokenCreator, inspectSetup, setupCommands, smsBuilt } from '../arc-sign-in-setup.mjs';

const SA = '449144539409-compute@developer.gserviceaccount.com';
const MEMBER = `serviceAccount:${SA}`;
const ROLE = 'roles/iam.serviceAccountTokenCreator';

/**
 * A fake gcloud: `api` and `role` say what the project has; every call is recorded.
 * `role: 'project'` grants it on the project instead of on the account.
 */
function fakeGcloud({ installed = true, api = true, role = 'account' as false | 'account' | 'project', grantFails = false } = {}) {
    const calls: string[] = [];
    const run = vi.fn((_cmd: string, args: string[]) => {
        const line = args.join(' ');
        calls.push(line);
        if (!installed) return { error: Object.assign(new Error('not found'), { code: 'ENOENT' }), status: null, stdout: '' };
        const ok = (stdout = '') => ({ status: 0, stdout });
        if (line === '--version') return ok('Google Cloud SDK 500.0.0');
        if (line.startsWith('projects describe')) return ok('449144539409\n');
        if (line.startsWith('services list')) return ok(api ? 'iamcredentials.googleapis.com\n' : '');
        if (line.startsWith('iam service-accounts get-iam-policy')) {
            return ok(JSON.stringify(role === 'account' ? { bindings: [{ role: ROLE, members: [MEMBER] }] } : {}));
        }
        if (line.startsWith('projects get-iam-policy')) {
            return ok(JSON.stringify(role === 'project' ? { bindings: [{ role: ROLE, members: [MEMBER] }] } : { bindings: [{ role: 'roles/editor', members: [MEMBER] }] }));
        }
        if (line.startsWith('services enable') || line.startsWith('iam service-accounts add-iam-policy-binding')) {
            return grantFails ? { status: 1, stdout: '' } : ok();
        }
        return { status: 1, stdout: '' };
    });
    return { run, calls };
}

function harness(gcloud: ReturnType<typeof fakeGcloud>, state: Record<string, any> = {}, answer = 'y', isTTY = true) {
    const log: string[] = [];
    const saved: Record<string, any>[] = [];
    const ask = vi.fn(async () => answer);
    const check = () => checkSignInSetup('sanskrit-app-live', {
        run: gcloud.run, state, save: (s: Record<string, any>) => saved.push(s), ask, isTTY, log: (l: string) => log.push(l),
    });
    return { check, log, saved, ask, out: () => log.join('\n') };
}

describe('arc-sign-in-setup', () => {
    it('reads the role from either policy, only for this member', () => {
        expect(grantsTokenCreator({ bindings: [{ role: ROLE, members: [MEMBER] }] }, MEMBER)).toBe(true);
        expect(grantsTokenCreator({ bindings: [{ role: ROLE, members: ['serviceAccount:other@x.iam.gserviceaccount.com'] }] }, MEMBER)).toBe(false);
        expect(grantsTokenCreator({ bindings: [{ role: 'roles/editor', members: [MEMBER] }] }, MEMBER)).toBe(false);
        expect(grantsTokenCreator({}, MEMBER)).toBe(false);
    });

    it('finds the compute account and what it has', () => {
        expect(inspectSetup('p', fakeGcloud().run)).toEqual({ serviceAccount: SA, apiOn: true, roleOn: true });
        expect(inspectSetup('p', fakeGcloud({ role: 'project' }).run)).toEqual({ serviceAccount: SA, apiOn: true, roleOn: true });
        expect(inspectSetup('p', fakeGcloud({ api: false, role: false }).run)).toEqual({ serviceAccount: SA, apiOn: false, roleOn: false });
        expect(inspectSetup('p', fakeGcloud({ installed: false }).run)).toEqual({ noGcloud: true });
    });

    it('builds only the commands for what is missing', () => {
        expect(setupCommands({ projectId: 'p', serviceAccount: SA, apiOn: true, roleOn: true })).toEqual([]);
        const both = setupCommands({ projectId: 'p', serviceAccount: SA, apiOn: false, roleOn: false }).map((c: string[]) => c.join(' '));
        expect(both).toEqual([
            'services enable iamcredentials.googleapis.com --project=p',
            `iam service-accounts add-iam-policy-binding ${SA} --member=${MEMBER} --role=${ROLE} --project=p`,
        ]);
    });

    it('says nothing when the project is set up, and does not check it again', async () => {
        const h = harness(fakeGcloud());
        await expect(h.check()).resolves.toBe('ok');
        expect(h.log).toEqual([]);
        expect(h.saved.at(-1)?.signInSetup).toEqual({ 'sanskrit-app-live': 'ok' });

        const again = harness(fakeGcloud(), { signInSetup: { 'sanskrit-app-live': 'ok' } });
        await expect(again.check()).resolves.toBe('skipped');
    });

    it('offers to set up what is missing, and runs it on a yes', async () => {
        const gcloud = fakeGcloud({ api: false, role: false });
        const h = harness(gcloud);
        await expect(h.check()).resolves.toBe('set-up');
        expect(h.out()).toContain('the iamcredentials.googleapis.com API is off');
        expect(h.out()).toContain(`${SA} does not have the Service Account Token Creator role`);
        expect(gcloud.calls).toContain('services enable iamcredentials.googleapis.com --project=sanskrit-app-live');
        expect(gcloud.calls.some((c) => c.startsWith(`iam service-accounts add-iam-policy-binding ${SA}`))).toBe(true);
        expect(h.saved.at(-1)?.signInSetup).toEqual({ 'sanskrit-app-live': 'ok' });
    });

    it('changes nothing on a no, prints the commands, and does not ask again', async () => {
        const gcloud = fakeGcloud({ role: false });
        const h = harness(gcloud, {}, 'n');
        await expect(h.check()).resolves.toBe('declined');
        expect(gcloud.calls.some((c) => c.includes('add-iam-policy-binding'))).toBe(false);
        expect(h.out()).toContain('gcloud iam service-accounts add-iam-policy-binding');
        expect(h.saved.at(-1)?.signInSetup).toEqual({ 'sanskrit-app-live': 'declined' });
    });

    it('off a terminal only prints the commands, and asks again next time', async () => {
        const gcloud = fakeGcloud({ role: false });
        const h = harness(gcloud, {}, 'y', false);
        await expect(h.check()).resolves.toBe('missing');
        expect(h.ask).not.toHaveBeenCalled();
        expect(gcloud.calls.some((c) => c.includes('add-iam-policy-binding'))).toBe(false);
        expect(h.saved).toEqual([]);
    });

    it('goes on with the deploy when granting fails', async () => {
        const h = harness(fakeGcloud({ role: false, grantFails: true }));
        await expect(h.check()).resolves.toBe('missing');
        expect(h.out()).toContain('Owner or Security Admin');
        expect(h.saved).toEqual([]);
    });

    it('without gcloud, says so once', async () => {
        const first = harness(fakeGcloud({ installed: false }));
        await expect(first.check()).resolves.toBe('no-gcloud');
        expect(first.out()).toContain('Install gcloud');
        expect(first.saved.at(-1)?.signInSetup).toEqual({ 'sanskrit-app-live': 'no-gcloud' });

        const second = harness(fakeGcloud({ installed: false }), { signInSetup: { 'sanskrit-app-live': 'no-gcloud' } });
        await expect(second.check()).resolves.toBe('no-gcloud');
        expect(second.log).toEqual([]);
    });

    it('checks once gcloud is installed after all', async () => {
        const h = harness(fakeGcloud(), { signInSetup: { 'sanskrit-app-live': 'no-gcloud' } });
        await expect(h.check()).resolves.toBe('ok');
    });

    it('says nothing when gcloud cannot read the project', async () => {
        const gcloud = fakeGcloud();
        gcloud.run.mockImplementation((_c: string, args: string[]) => (args[0] === '--version' ? { status: 0, stdout: 'x' } : { status: 1, stdout: '' }));
        const h = harness(gcloud);
        await expect(h.check()).resolves.toBe('unknown');
        expect(h.log).toEqual([]);
    });

    it('runs only when the functions build has the sms feature', () => {
        const dir = mkdtempSync(join(tmpdir(), 'sign-in-setup-'));
        try {
            mkdirSync(join(dir, 'functions', 'src'), { recursive: true });
            const gen = join(dir, 'functions', 'src', 'enabled-features.gen.ts');
            writeFileSync(gen, 'export const ENABLED_FEATURES: readonly string[] = ["content","sms"];\n');
            expect(smsBuilt(dir)).toBe(true);
            writeFileSync(gen, 'export const ENABLED_FEATURES: readonly string[] = ["content"];\n');
            expect(smsBuilt(dir)).toBe(false);
            rmSync(gen);
            expect(smsBuilt(dir)).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
