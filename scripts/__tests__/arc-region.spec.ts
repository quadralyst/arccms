/**
 * The functions run next to the database (scripts/arc-region.mjs,
 * docs/operations/deploy.html#regions): a first deploy puts them there, a later
 * one warns when they are elsewhere.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import * as region from '../arc-region.mjs';
// @ts-expect-error: plain ESM script without type declarations
import * as configure from '../arc-configure.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { checkFunctionsRegion, deploysWebsite } from '../arc-deploy.mjs';

const ROOT = resolve(__dirname, '..', '..');
const committedFirebase = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));

describe('which region the functions belong in', () => {
    it('is the database region itself when functions run there', () => {
        expect(region.functionsRegionFor('asia-south1')).toBe('asia-south1');
        expect(region.functionsRegionFor('europe-west2')).toBe('europe-west2');
    });

    it('is the home region of a multi-region database, or the nearest one with functions', () => {
        expect(region.functionsRegionFor('nam5')).toBe('us-central1');
        expect(region.functionsRegionFor('eur3')).toBe('europe-west1');
        expect(region.functionsRegionFor('asia-south2')).toBe('asia-south1');
        expect(region.functionsRegionFor('mars-north1')).toBe('');
        expect(region.functionsRegionFor('')).toBe('');
    });

    it('counts functions inside a multi-region location as next to it', () => {
        expect(region.regionsMatch('nam5', 'us-central1')).toBe(true);
        expect(region.regionsMatch('nam5', 'us-east4')).toBe(true);
        expect(region.regionsMatch('asia-south1', 'us-central1')).toBe(false);
        expect(region.regionsMatch('', 'us-central1')).toBe(true);
    });

    it('knows every region the functions SDK supports', () => {
        const types = readFileSync(join(ROOT, 'functions/node_modules/firebase-functions/lib/v2/options.d.ts'), 'utf8');
        const supported = /export type SupportedRegion = ([^;]+);/.exec(types)![1].match(/"([a-z0-9-]+)"/g)!.map((r) => r.slice(1, -1));
        expect([...region.FUNCTIONS_REGIONS].sort()).toEqual(supported.sort());
    });
});

describe('the decision before a functions deploy', () => {
    it('does nothing when the functions are next to the database, or the location is unknown', () => {
        expect(region.regionDecision({ location: 'nam5', region: 'us-central1', deployedArccms: 40 }).kind).toBe('ok');
        expect(region.regionDecision({ location: '', region: 'us-central1', deployedArccms: 0 }).kind).toBe('ok');
    });

    it('moves nothing that is deployed: with no Arc CMS function yet it sets the region, after that it warns', () => {
        expect(region.regionDecision({ location: 'asia-south1', region: '', deployedArccms: 0 }))
            .toEqual({ kind: 'adopt', location: 'asia-south1', region: 'us-central1', suggested: 'asia-south1' });
        expect(region.regionDecision({ location: 'asia-south1', region: 'us-central1', deployedArccms: 40 }).kind).toBe('warn');
        expect(region.regionDecision({ location: 'asia-south1', region: 'us-central1', deployedArccms: null }).kind).toBe('warn');
        expect(region.regionDecision({ location: 'mars-north1', region: 'us-central1', deployedArccms: 0 }).kind).toBe('warn');
    });

    it('warns in plain words, with the fix', () => {
        const text = region.regionWarning({ location: 'asia-south1', region: 'us-central1', suggested: 'asia-south1' }, 'p');
        expect(text).toContain('Your database is in asia-south1, but the functions run in us-central1.');
        expect(text).toContain('docs/operations/deploy.html');
        expect(text).not.toMatch(/[–—]/);
        expect(region.regionWarning({ location: 'mars-north1', region: 'us-central1', suggested: '' }, 'p'))
            .toContain('--functions-region=<region>');
    });

    it('counts only the Arc CMS functions, so another app in the project does not count', () => {
        expect(region.countArccms(null)).toBeNull();
        expect(region.countArccms([
            { id: 'arccms-a', codebase: 'arccms' },
            { id: 'b', labels: { 'firebase-functions-codebase': 'arccms' } },
            { id: 'hostFn', codebase: 'default' },
        ])).toBe(2);
    });
});

describe('the database location', () => {
    const reply = (locationId?: string) => ({ stdout: JSON.stringify(locationId ? { status: 'success', result: { locationId } } : { status: 'error' }) });

    it('falls back to the (default) database, where a deploy would create a missing one', () => {
        const run = vi.fn((_cmd: string, args: string[]) => reply(args[1] === 'arccms' ? undefined : 'asia-south1'));
        expect(region.lookupDatabaseLocation('p', 'arccms', run)).toBe('asia-south1');
        expect(run.mock.calls.map((c) => c[1][1])).toEqual(['arccms', '(default)']);
        expect(region.lookupDatabaseLocation('p', '(default)', vi.fn(() => ({ stdout: 'not json' })))).toBe('');
    });

    it('is looked up once and remembered', () => {
        const lookup = vi.fn(() => 'asia-south1');
        const first = region.databaseLocation({}, 'p', 'arccms', lookup);
        expect(first.location).toBe('asia-south1');
        expect(first.state.databaseLocations).toEqual({ p: { arccms: 'asia-south1' } });
        expect(region.databaseLocation(first.state, 'p', 'arccms', lookup).location).toBe('asia-south1');
        expect(lookup).toHaveBeenCalledTimes(1);
        const unknown = region.databaseLocation({}, 'p', 'arccms', () => '');
        expect(unknown).toEqual({ location: '', state: {} });
    });
});

describe('checkFunctionsRegion', () => {
    function deps(over: Record<string, unknown> = {}) {
        return {
            config: { databaseId: 'arccms' },
            state: { databaseLocations: { p: { arccms: 'asia-south1' } } },
            save: vi.fn(),
            lookup: vi.fn(() => 'asia-south1'),
            list: vi.fn(() => []),
            write: vi.fn(() => 0),
            log: vi.fn(),
            ...over,
        };
    }

    it('lets the deploy go on when the functions are next to the database, without listing anything', () => {
        const d = deps({ config: { databaseId: 'arccms', functionsRegion: 'asia-south1' } });
        expect(checkFunctionsRegion('p', { deps: d })).toMatchObject({ proceed: true, decision: { kind: 'ok' } });
        expect(d.list).not.toHaveBeenCalled();
        expect(d.lookup).not.toHaveBeenCalled();
    });

    it('on a first deploy, sets the functions next to the database and deploys', () => {
        const d = deps();
        expect(checkFunctionsRegion('p', { deps: d })).toMatchObject({ proceed: true, decision: { kind: 'adopt', suggested: 'asia-south1' } });
        expect(d.write).toHaveBeenCalledWith(['--project=p', '--functions-region=asia-south1'], undefined, expect.any(Function));
        expect(d.log.mock.calls.join('\n')).toContain('The functions will run in asia-south1, next to your database (asia-south1).');
    });

    it('a first deploy that also publishes the website goes on: the website is built after the check', () => {
        const d = deps();
        expect(checkFunctionsRegion('p', { deps: d }).proceed).toBe(true);
        expect(d.log.mock.calls.join('\n')).not.toContain('Nothing was deployed.');
        expect(deploysWebsite(['--only', 'functions,hosting'])).toBe(true);
        expect(deploysWebsite(['--project', 'p'])).toBe(true);
        expect(deploysWebsite(['--only', 'functions:arccms'])).toBe(false);
        // The order in runDeploy that makes this safe: the region check, then the website build.
        const source = readFileSync(resolve(__dirname, '../arc-deploy.mjs'), 'utf8');
        const body = source.slice(source.indexOf('export async function runDeploy('));
        expect(body.indexOf('checkFunctionsRegion(projectId)')).toBeGreaterThan(0);
        expect(body.indexOf('checkFunctionsRegion(projectId)')).toBeLessThan(body.indexOf("builds.includes('website')"));
    });

    it('says what is committed and what is not, and what CI must pass', () => {
        const d = deps();
        checkFunctionsRegion('p', { deps: d });
        const said = d.log.mock.calls.join('\n');
        expect(said).toContain('Saved in arccms.config.json, which git ignores, and in src/environments/arc-install.ts: commit that one');
        expect(said).toContain('add --functions-region=asia-south1 to arc:configure');
        expect(said).not.toContain('commit it with');
    });

    it('with functions already deployed elsewhere, warns and deploys, unless the warning is off', () => {
        const d = deps({ list: vi.fn(() => [{ id: 'arccms-a', codebase: 'arccms' }]) });
        expect(checkFunctionsRegion('p', { deps: d })).toMatchObject({ proceed: true, decision: { kind: 'warn' } });
        expect(d.write).not.toHaveBeenCalled();
        expect(d.log.mock.calls.join('\n')).toContain('Your database is in asia-south1, but the functions run in us-central1.');

        const quiet = deps({
            list: vi.fn(() => [{ id: 'arccms-a', codebase: 'arccms' }]),
            state: { databaseLocations: { p: { arccms: 'asia-south1' } }, regionWarningOff: { p: true } },
        });
        expect(checkFunctionsRegion('p', { deps: quiet }).proceed).toBe(true);
        expect(quiet.log).not.toHaveBeenCalled();
    });

    it('remembers a location it had to look up', () => {
        const d = deps({ state: {}, config: { databaseId: 'arccms', functionsRegion: 'asia-south1' } });
        checkFunctionsRegion('p', { deps: d });
        expect(d.save).toHaveBeenCalledWith({ databaseLocations: { p: { arccms: 'asia-south1' } } });
    });

    it('stops when the region cannot be saved', () => {
        const d = deps({ write: vi.fn((_a: string[], _p: unknown, log: (l: string) => void) => { log('error: x'); return 1; }) });
        expect(checkFunctionsRegion('p', { deps: d }).proceed).toBe(false);
        expect(d.log).toHaveBeenCalledWith('error: x');
    });
});

describe('arc:configure and the functions region', () => {
    it('reads --functions-region, and follows a --region given for the database', () => {
        expect(configure.parseFlags(['--functions-region=asia-south1']).updates).toEqual({ functionsRegion: 'asia-south1' });
        expect(configure.normalizeConfig({ region: 'nam5' }).functionsRegion).toBe('us-central1');
        expect(configure.normalizeConfig({ region: 'asia-south1', functionsRegion: 'europe-west1' }).functionsRegion).toBe('europe-west1');
        expect(configure.normalizeConfig({ region: 'mars-north1' }).functionsRegion).toBeUndefined();
    });

    it('refuses something that is not a region', () => {
        expect(configure.validateConfig(configure.normalizeConfig({ functionsRegion: 'Mumbai' })))
            .toContain('functions-region "Mumbai" is not a region, such as asia-south1 or us-central1.');
        expect(configure.validateConfig(configure.normalizeConfig({ functionsRegion: 'asia-south1' }))).toEqual([]);
    });

    it('tells the functions, the website and the Hosting rewrites, and changes nothing for us-central1', () => {
        const config = configure.normalizeConfig({ functionsRegion: 'asia-south1' });
        expect(configure.updateFunctionsEnv('', config)).toContain('ARC_FUNCTIONS_REGION=asia-south1\n');
        expect(configure.appValues(config)).toEqual({ functionsRegion: 'asia-south1' });
        const out = configure.renderFirebaseConfig(committedFirebase, config);
        const functionRewrites = out.hosting.rewrites.filter((r: { function?: unknown }) => r.function);
        expect(functionRewrites.length).toBeGreaterThan(0);
        for (const rewrite of functionRewrites) expect(rewrite.function.region).toBe('asia-south1');
        expect(out.hosting.rewrites.find((r: { destination?: string }) => r.destination === '/__shell.html')).not.toHaveProperty('function');

        const usual = configure.normalizeConfig({ functionsRegion: 'us-central1' });
        expect(configure.appValues(usual)).toBeNull();
        expect(configure.renderFirebaseConfig(committedFirebase, usual)).toBeNull();
    });
});
