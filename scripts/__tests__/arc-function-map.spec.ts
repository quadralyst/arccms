/**
 * scripts/arc-function-map.mjs (F35): the map from each function to the file that
 * defines it, which lets an instance load only that file as it starts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
// @ts-expect-error plain JavaScript script, no types
import { reexportsOf } from '../arc-function-map.mjs';

const ROOT = resolve(__dirname, '../..');
const fn = (name: string) => `export const ${name} = Object.assign(() => undefined, { __endpoint: { platform: 'gcfv2' } });\n`;

const SCRIPT = resolve(ROOT, 'scripts/arc-function-map.mjs');
let made: string[] = [];
afterEach(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
    made = [];
});

/**
 * The script run on a build as the functions' postbuild runs it, in Node itself: Vitest's
 * loader does not load files outside the project. What it wrote, and what it said.
 */
function mapOf(lib: string): { map: { functions: Record<string, [string, string]> }; said: string } {
    const said = execFileSync(process.execPath, [SCRIPT, lib], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { map: JSON.parse(readFileSync(join(lib, 'function-map.json'), 'utf8')), said };
}

/** A fake compiled functions build: file name to its code. */
function build(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'arc-fnmap-')));
    made.push(dir);
    writeFileSync(join(dir, 'package.json'), '{ "type": "module" }');
    for (const [file, code] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), code);
    }
    return dir;
}

describe('arc-function-map', () => {
    it('follows re-exports down to the file that defines each function', () => {
        const lib = build({
            'all.js': [
                '/** Every function. */',
                "export * from './auth/phone.js';",
                '// A feature, when it is on.',
                "export * from './feature-exports.gen.js';",
                "export { syncTemplates as syncAppEmailTemplates } from './email/sync.js';",
                "export * as custom from './custom/index.js';",
                '//# sourceMappingURL=all.js.map',
            ].join('\n'),
            'auth/phone.js': `import '../shared.js';\n${fn('signInWithPin')}${fn('resetPin')}export function readNewPin() { return ''; }\n`,
            'shared.js': 'export const shared = 1;\n',
            'feature-exports.gen.js': "export * from './features/search.js';\n",
            'features/search.js': "export * from '../search/search.js';\n",
            'search/search.js': fn('search'),
            'email/sync.js': `${fn('syncTemplates')}${fn('notExported')}`,
            'custom/index.js': "export * from './lessons.js';\nexport * as pos from './pos.js';\n",
            'custom/lessons.js': fn('completeLesson'),
            'custom/pos.js': fn('serve'),
        });
        const { map, said } = mapOf(lib);
        expect(map.functions).toEqual({
            'custom.completeLesson': ['custom/lessons.js', 'completeLesson'],
            'custom.pos.serve': ['custom/pos.js', 'serve'],
            resetPin: ['auth/phone.js', 'resetPin'],
            search: ['search/search.js', 'search'],
            signInWithPin: ['auth/phone.js', 'signInWithPin'],
            syncAppEmailTemplates: ['email/sync.js', 'syncTemplates'],
        });
        expect(said).toContain('6 functions placed');
        expect(said).not.toContain('load every function');
    });

    it('maps the functions of a file with code of its own to that file, such as an app index written by hand', () => {
        const lib = build({
            'all.js': "export * as custom from './custom/index.js';\n",
            'custom/index.js': `import './helpers.js';\n${fn('hello')}export * from './more.js';\n`,
            'custom/helpers.js': 'export const x = 1;\n',
            'custom/more.js': fn('more'),
        });
        const { map } = mapOf(lib);
        expect(map.functions).toEqual({
            'custom.hello': ['custom/index.js', 'hello'],
            'custom.more': ['custom/index.js', 'more'],
        });
    });

    it('leaves out a name two files export, which ES modules leave out of all.js too', () => {
        const lib = build({
            'all.js': "export * from './a.js';\nexport * from './b.js';\n",
            'a.js': `${fn('same')}${fn('onlyA')}`,
            'b.js': fn('same'),
        });
        const { map } = mapOf(lib);
        expect(map.functions).toEqual({ onlyA: ['a.js', 'onlyA'] });
    });

    it('reads Arc CMS\'s own all.ts and feature files as re-exports only, so every core function is placed in its own file', () => {
        const src = resolve(ROOT, 'functions/src');
        for (const file of ['all.ts', ...readdirSync(join(src, 'features')).map((name) => `features/${name}`)]) {
            expect(reexportsOf(readFileSync(join(src, file), 'utf8')), file).not.toBeNull();
        }
    });

    it('runs after every functions build', () => {
        const pkg = JSON.parse(readFileSync(resolve(ROOT, 'functions/package.json'), 'utf8'));
        expect(pkg.scripts.postbuild).toBe('node ../scripts/arc-function-map.mjs');
    });
});
