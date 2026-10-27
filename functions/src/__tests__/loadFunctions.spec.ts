/**
 * Which code a function instance loads as it starts (load-functions.ts, F35): only the
 * file of the function FUNCTION_TARGET names, when the build's map knows it; every
 * function otherwise, as a deploy, the scripts and the tests need.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadFunctions, readFunctionMap, targetPath, type FunctionMap } from '../load-functions.js';

const signIn = () => 'signed in';
const hello = () => 'hello';
const ALL = { signInWithPin: signIn, custom: { hello } };

const MAP: FunctionMap = {
    functions: {
        signInWithPin: ['auth/phoneAuth.js', 'signInWithPin'],
        'custom.hello': ['custom/hello.js', 'hello'],
        'custom.pos.serve': ['custom/pos.js', 'serveNow'],
    },
};

function loader(files: Record<string, Record<string, unknown>>) {
    return vi.fn(async (file: string) => {
        if (!files[file]) throw new Error(`no ${file}`);
        return files[file];
    });
}

describe('targetPath', () => {
    it('reads the function inside the arccms group from FUNCTION_TARGET', () => {
        expect(targetPath('arccms.signInWithPin')).toBe('signInWithPin');
        expect(targetPath('arccms.custom.hello')).toBe('custom.hello');
    });

    it('is null for anything that is not one of ours, or not a target at all', () => {
        for (const target of [undefined, '', 'arccms', 'arccms.', 'other.signInWithPin', 'arccms.a..b', 'arccms.a/b', 'signInWithPin']) {
            expect(targetPath(target)).toBeNull();
        }
    });
});

describe('loadFunctions', () => {
    afterEach(() => vi.restoreAllMocks());

    it('loads only the file of the function the instance serves', async () => {
        const load = loader({ 'auth/phoneAuth.js': { signInWithPin: signIn, readNewPin: () => '' }, 'all.js': ALL });
        const group = await loadFunctions('arccms.signInWithPin', MAP, load);
        expect(group).toEqual({ signInWithPin: signIn });
        expect(load).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledWith('auth/phoneAuth.js');
    });

    it('nests an app function where Firebase looks for it, under its own export name', async () => {
        const load = loader({ 'custom/hello.js': { hello }, 'custom/pos.js': { serveNow: hello } });
        expect(await loadFunctions('arccms.custom.hello', MAP, load)).toEqual({ custom: { hello } });
        expect(await loadFunctions('arccms.custom.pos.serve', MAP, load)).toEqual({ custom: { pos: { serve: hello } } });
    });

    it('loads every function for a deploy, a script or a test: no FUNCTION_TARGET', async () => {
        const load = loader({ 'all.js': ALL });
        expect(await loadFunctions(undefined, MAP, load)).toBe(ALL);
        expect(load).toHaveBeenCalledWith('all.js');
    });

    it('loads every function when the map is missing, or does not name the function', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const load = loader({ 'all.js': ALL });
        expect(await loadFunctions('arccms.signInWithPin', null, load)).toBe(ALL);
        expect(await loadFunctions('arccms.newFunction', MAP, load)).toBe(ALL);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('does not list newFunction'));
    });

    it('loads every function when the file no longer exports it (a map from another build)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const load = loader({ 'auth/phoneAuth.js': { readNewPin: () => '' }, 'all.js': ALL });
        expect(await loadFunctions('arccms.signInWithPin', MAP, load)).toBe(ALL);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('does not export it'));
    });
});

describe('readFunctionMap', () => {
    it('reads the map beside the build, and is null for a missing or broken one', () => {
        const dir = mkdtempSync(join(tmpdir(), 'arc-map-'));
        writeFileSync(join(dir, 'good.json'), JSON.stringify(MAP));
        writeFileSync(join(dir, 'broken.json'), '{ not json');
        expect(readFunctionMap(pathToFileURL(join(dir, 'good.json')))).toEqual(MAP);
        expect(readFunctionMap(pathToFileURL(join(dir, 'broken.json')))).toBeNull();
        expect(readFunctionMap(pathToFileURL(join(dir, 'missing.json')))).toBeNull();
    });
});
