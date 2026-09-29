/**
 * A full functions deploy deletes what the build no longer has (a feature turned
 * off, a search collection removed). arc-deploy lists those and asks once
 * (docs/feature-flags-spec.md, section 7).
 */
import { describe, it, expect, vi } from 'vitest';
import { confirmDeletes, deployArgs, deploysWholeFunctions, functionIds, removedFunctions } from '../arc-deploy.mjs';

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
