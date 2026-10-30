// @vitest-environment node
/**
 * The cleanup policy of the functions' container images (scripts/arc-artifact-cleanup.mjs):
 * set before a deploy with functions, and on a first deploy as soon as the repository
 * exists, so the Firebase CLI never stops at its own question about it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_ARTIFACT_CLEANUP_DAYS, cleanupSetting, cliFoundNoPolicy, ensureCleanupPolicy, forgetPolicy, policyResult,
    rememberPolicy, rememberedPolicy, setPolicyArgs, setPolicyCommand, watchForRepository,
} from '../arc-artifact-cleanup.mjs';
import { CLEANUP_PROMPT_HINT, cliMayAsk } from '../arc-deploy.mjs';

/** What `firebase functions:artifacts:setpolicy` prints when the repository is not there yet (firebase-tools 15). */
const MISSING = "i  Repository 'projects/p/locations/us-east1/repositories/gcf-artifacts' does not exist in Artifact Registry.\n"
    + 'i  Please deploy your functions first using: firebase deploy --only functions\n';
const SET = '✔  Successfully set up cleanup policy that deletes images older than 1 days\n';

/** A Firebase CLI stand-in that answers each call with the next of `answers` (the last one repeats). */
function cli(answers: { status: number; output: string }[]) {
    const calls: string[][] = [];
    const exec = vi.fn(async (args: string[]) => {
        calls.push(args);
        return answers[Math.min(calls.length - 1, answers.length - 1)];
    });
    return { exec, calls };
}

function deps(answers: { status: number; output: string }[], state: Record<string, unknown> = {}) {
    const store = { state };
    const log = vi.fn();
    const { exec, calls } = cli(answers);
    return {
        store, log, calls,
        deps: { exec, log, readState: () => store.state, save: (next: Record<string, unknown>) => { store.state = next; } },
    };
}

describe('the setting', () => {
    it('keeps images 1 day unless the project says otherwise, and none opts out', () => {
        expect(DEFAULT_ARTIFACT_CLEANUP_DAYS).toBe(1);
        expect(cleanupSetting({})).toBe(1);
        expect(cleanupSetting(undefined)).toBe(1);
        expect(cleanupSetting({ artifactCleanupDays: '7' })).toBe(7);
        expect(cleanupSetting({ artifactCleanupDays: 'none' })).toBe('none');
    });

    it('builds the setpolicy arguments, never asking, with --none for the opt-out', () => {
        expect(setPolicyArgs('acme', 'us-east1', 1))
            .toEqual(['functions:artifacts:setpolicy', '--location', 'us-east1', '--days', '1', '--force', '--project', 'acme']);
        expect(setPolicyArgs('acme', 'asia-south1', 'none'))
            .toEqual(['functions:artifacts:setpolicy', '--location', 'asia-south1', '--none', '--force', '--project', 'acme']);
        expect(setPolicyCommand('acme', 'us-east1', 3))
            .toBe('firebase functions:artifacts:setpolicy --location us-east1 --days 3 --force --project acme');
    });

    it('tells a missing repository (exit 0) from a set policy and a failure', () => {
        expect(policyResult(0, MISSING)).toBe('missing');
        expect(policyResult(0, SET)).toBe('set');
        expect(policyResult(0, 'i  A cleanup policy already exists that deletes images older than 1 days.\ni  No changes needed.')).toBe('set');
        expect(policyResult(1, 'Error: Failed to set up artifact registry cleanup policy')).toBe('failed');
    });

    it('remembers a policy per project, region and setting, and forgets it', () => {
        const state = rememberPolicy({ lastProject: 'acme' }, 'acme', 'us-east1', 1);
        expect(state).toEqual({ lastProject: 'acme', artifactCleanup: { acme: 'us-east1:1' } });
        expect(rememberedPolicy(state, 'acme', 'us-east1', 1)).toBe(true);
        expect(rememberedPolicy(state, 'acme', 'us-east1', 7)).toBe(false);
        expect(rememberedPolicy(state, 'acme', 'asia-south1', 1)).toBe(false);
        expect(rememberedPolicy(state, 'other', 'us-east1', 1)).toBe(false);
        expect(forgetPolicy(state, 'acme')).toEqual({ lastProject: 'acme', artifactCleanup: {} });
    });
});

describe('before a deploy with functions', () => {
    it('sets the policy and remembers it, so the next deploy does not ask Google again', async () => {
        const d = deps([{ status: 0, output: SET }]);
        expect(await ensureCleanupPolicy('acme', { region: 'us-east1', setting: 1, deps: d.deps })).toBe('set');
        expect(d.calls).toEqual([setPolicyArgs('acme', 'us-east1', 1)]);
        expect(d.store.state).toEqual({ artifactCleanup: { acme: 'us-east1:1' } });
        expect(d.log.mock.calls.join('\n')).toContain("Cleanup policy for the functions' container images in us-east1: images kept 1 day.");

        expect(await ensureCleanupPolicy('acme', { region: 'us-east1', setting: 1, deps: d.deps })).toBe('remembered');
        expect(d.calls).toHaveLength(1);
    });

    it('sets it again when the days or the region change', async () => {
        const d = deps([{ status: 0, output: SET }], { artifactCleanup: { acme: 'us-east1:1' } });
        expect(await ensureCleanupPolicy('acme', { region: 'us-east1', setting: 'none', deps: d.deps })).toBe('set');
        expect(d.calls).toEqual([setPolicyArgs('acme', 'us-east1', 'none')]);
        expect(d.store.state).toEqual({ artifactCleanup: { acme: 'us-east1:none' } });
        expect(d.log.mock.calls.join('\n')).toContain('no cleanup (artifactCleanupDays is none)');
    });

    it('on a first deploy, says the repository does not exist yet and remembers nothing', async () => {
        const d = deps([{ status: 0, output: MISSING }]);
        expect(await ensureCleanupPolicy('acme', { region: 'us-east1', setting: 1, deps: d.deps })).toBe('missing');
        expect(d.store.state).toEqual({});
        expect(d.log.mock.calls.join('\n')).toContain('does not exist yet (a first deploy)');
    });

    it('never stops the deploy when it cannot set the policy: it tries again while the deploy runs, then says how to set it', async () => {
        const denied = { status: 1, output: "Error: You don't have permission to update this repository." };
        const d = deps([denied]);
        expect(await ensureCleanupPolicy('acme', { region: 'us-east1', setting: 1, deps: d.deps })).toBe('failed');
        expect(d.store.state).toEqual({});
        expect(d.log.mock.calls.join('\n')).toContain("yet (Error: You don't have permission to update this repository.). Trying again while the deploy runs.");

        const watch = watchForRepository('acme', { region: 'us-east1', setting: 1, deps: d.deps, every: 60_000 });
        expect(await watch.stop()).toBe('failed');
        const said = d.log.mock.calls.join('\n');
        expect(said).toContain('The next deploy tries again. To set it now: firebase functions:artifacts:setpolicy --location us-east1 --days 1 --force --project acme');
    });

    it('a first try that fails on a new project (Artifact Registry just turned on) succeeds while the deploy runs', async () => {
        const d = deps([{ status: 1, output: 'Error: Artifact Registry API has not been used in project acme before or it is disabled.' }, { status: 0, output: SET }]);
        expect(await ensureCleanupPolicy('acme', { region: 'us-east1', setting: 1, deps: d.deps })).toBe('failed');
        expect(await watchForRepository('acme', { region: 'us-east1', setting: 1, deps: d.deps, every: 60_000 }).stop()).toBe('set');
        expect(d.store.state).toEqual({ artifactCleanup: { acme: 'us-east1:1' } });
    });
});

describe('a first deploy: the repository appears while the deploy runs', () => {
    afterEach(() => vi.useRealTimers());

    it('sets the policy as soon as the repository exists, before the deploy ends', async () => {
        vi.useFakeTimers();
        const d = deps([{ status: 0, output: MISSING }, { status: 0, output: SET }]);
        const watch = watchForRepository('acme', { region: 'us-east1', setting: 1, deps: d.deps, every: 1000 });
        await vi.advanceTimersByTimeAsync(1000);
        expect(d.calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(d.calls).toHaveLength(2);
        expect(d.store.state).toEqual({ artifactCleanup: { acme: 'us-east1:1' } });
        // Set: no more tries, and stop does not try again.
        await vi.advanceTimersByTimeAsync(5000);
        expect(await watch.stop()).toBe('set');
        expect(d.calls).toHaveLength(2);
        expect(d.log.mock.calls.join('\n')).toContain('images kept 1 day');
    });

    it('tries once more when the deploy ends, when the repository came late', async () => {
        const d = deps([{ status: 0, output: SET }]);
        const watch = watchForRepository('acme', { region: 'us-east1', setting: 7, deps: d.deps, every: 60_000 });
        expect(await watch.stop()).toBe('set');
        expect(d.calls).toEqual([setPolicyArgs('acme', 'us-east1', 7)]);
        expect(d.store.state).toEqual({ artifactCleanup: { acme: 'us-east1:7' } });
    });

    it('when no function was built, says the next deploy sets it', async () => {
        const d = deps([{ status: 0, output: MISSING }]);
        const watch = watchForRepository('acme', { region: 'us-east1', setting: 1, deps: d.deps, every: 60_000 });
        expect(await watch.stop()).toBe('missing');
        expect(d.store.state).toEqual({});
        expect(d.log.mock.calls.join('\n')).toContain('still does not exist, so its cleanup policy is not set yet. The next deploy sets it.');
    });

    it('waits for a try already running instead of starting a second one', async () => {
        vi.useFakeTimers();
        let finish: (value: { status: number; output: string }) => void = () => {};
        const calls: string[][] = [];
        const exec = vi.fn((args: string[]) => {
            calls.push(args);
            return new Promise<{ status: number; output: string }>((done) => { finish = done; });
        });
        const watch = watchForRepository('acme', { region: 'us-east1', setting: 1, deps: { exec, log: vi.fn() }, every: 1000 });
        await vi.advanceTimersByTimeAsync(3000);
        expect(calls).toHaveLength(1);
        const stopped = watch.stop();
        finish({ status: 0, output: SET });
        expect(await stopped).toBe('set');
        expect(calls).toHaveLength(1);
    });
});

describe('when the Firebase CLI asks after all', () => {
    it('recognises its warning', () => {
        expect(cliFoundNoPolicy('⚠  functions: No cleanup policy detected for repositories in us-east1. This may result in a small monthly bill')).toBe(true);
        expect(cliFoundNoPolicy('✔  Deploy complete!')).toBe(false);
    });

    it('explains the bare prompt only where the CLI can ask: a terminal, without --force or --non-interactive', () => {
        expect(cliMayAsk(['deploy', '--project', 'acme'], true)).toBe(true);
        expect(cliMayAsk(['deploy', '--project', 'acme'], false)).toBe(false);
        expect(cliMayAsk(['deploy', '--project', 'acme', '--force'], true)).toBe(false);
        expect(cliMayAsk(['deploy', '--project', 'acme', '--non-interactive'], true)).toBe(false);
        expect(CLEANUP_PROMPT_HINT).toContain('how many days to keep');
    });
});
