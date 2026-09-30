/**
 * A full functions deploy deletes what the build no longer has (a feature turned
 * off, a search collection removed). arc-deploy lists those and asks once
 * (specs/feature-flags-spec.md, section 7).
 */
import { describe, it, expect, vi } from 'vitest';
import { confirmDeletes, deletesByRegion, deployArgs, deploysWholeFunctions, functionIds, onlyFunctionErrors, removedDeployed, removedFunctions } from '../arc-deploy.mjs';

const fn = (id: string, codebase = 'arccms') => ({ id, codebase, region: 'us-central1' });

describe('which deploys can delete', () => {
    it('a whole codebase does, a named function never does', () => {
        expect(deploysWholeFunctions([])).toBe(true);
        expect(deploysWholeFunctions(['--only', 'functions'])).toBe(true);
        expect(deploysWholeFunctions(['--only', 'functions:arccms,firestore:rules'])).toBe(true);
        expect(deploysWholeFunctions(['--only=functions:arccms'])).toBe(true);
        expect(deploysWholeFunctions(['--only', 'functions:arccms:arccms.search'])).toBe(false);
        expect(deploysWholeFunctions(['--only', 'hosting'])).toBe(false);
    });
});

describe('what a deploy would delete', () => {
    const noop = () => undefined;
    const built = { search: { __endpoint: {} }, helper: noop, searchSync: { Lessons: { __endpoint: {} } }, custom: { award: { __endpoint: {} } } };

    it('names the built functions as they are deployed, nested groups included', () => {
        expect(functionIds(built).sort()).toEqual(['arccms-custom-award', 'arccms-search', 'arccms-searchSync-Lessons']);
    });

    it("lists arccms functions the build lacks, never another codebase's", () => {
        const deployed = [fn('arccms-search'), fn('arccms-onAnyDocumentWritten'), fn('arccms-trackPwaEvent'), fn('hostThing', 'default')];
        expect(removedFunctions(deployed, functionIds(built))).toEqual(['arccms-onAnyDocumentWritten', 'arccms-trackPwaEvent']);
    });
});

describe('confirmDeletes', () => {
    const quiet = () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    };

    it('goes ahead without asking when nothing is deleted', async () => {
        const ask = vi.fn();
        expect(await confirmDeletes([], [], { isTTY: true, ask })).toEqual({ proceed: true, force: false });
        expect(ask).not.toHaveBeenCalled();
    });

    it('takes --yes, or an explicit --force, as the answer', async () => {
        quiet();
        expect(await confirmDeletes(['arccms-x'], ['--yes'], { isTTY: false })).toEqual({ proceed: true, force: true });
        expect(await confirmDeletes(['arccms-x'], ['--force'], { isTTY: false })).toEqual({ proceed: true, force: true });
    });

    it('stops off a terminal without --yes', async () => {
        quiet();
        expect(await confirmDeletes(['arccms-x'], [], { isTTY: false })).toEqual({ proceed: false, force: false });
    });

    it('asks once on a terminal', async () => {
        quiet();
        expect(await confirmDeletes(['arccms-x'], [], { isTTY: true, ask: async () => 'y' })).toEqual({ proceed: true, force: true });
        expect(await confirmDeletes(['arccms-x'], [], { isTTY: true, ask: async () => '' })).toEqual({ proceed: false, force: false });
    });

    it('never passes --yes on to the Firebase CLI', () => {
        expect(deployArgs(['--only', 'functions', '--yes'], false, 'p1')).toEqual(['deploy', '--only', 'functions', '--project', 'p1']);
    });
});

describe('when a function update fails', () => {
    // From the deploy of 2026-09-29: one update failed, so the CLI skipped every delete.
    const output = [
        '✔  firestore: released rules .arc-build/firestore.rules to cloud.firestore',
        '⚠  functions: Deploys failed. Skipping deletes.',
        'Error: There was an error deploying functions:',
        '- Error Failed to update function arccms-onUserCreateWelcomeEmail in region us-central1',
        '- Error Failed to delete function arccms-onAnyDocumentWritten in region us-central1',
    ].join('\n');

    it('knows the failure was only functions, so a clean retry settles it', () => {
        expect(onlyFunctionErrors(output)).toBe(true);
        expect(onlyFunctionErrors(`${output}\nError: HTTP Error: 400, the rules did not compile`)).toBe(false);
        expect(onlyFunctionErrors('all good')).toBe(false);
    });

    it('finishes the agreed deletes region by region', () => {
        const deployed = [fn('arccms-a'), { ...fn('arccms-b'), region: 'asia-south1' }, fn('arccms-keep')];
        const removed = removedDeployed(deployed, ['arccms-keep']);
        expect(deletesByRegion(removed)).toEqual({ 'us-central1': ['arccms-a'], 'asia-south1': ['arccms-b'] });
    });
});
