// @vitest-environment node
/**
 * The app's version and build number (specs/app-version-spec.md, AV-D1 to AV-D7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { appVersion, buildCommit, buildFromEnv, checkLabel, nextBuild, readAppPackage, versionOf, versionText, withBuild } from '../arc-version.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { buildNodeOptions, buildOptions, planBuild, runWebsiteBuild } from '../arc-website-build.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { splitBuildFlags } from '../arc-deploy.mjs';

describe('nextBuild', () => {
    it('counts on from the last build', () => {
        expect(nextBuild({ build: 24 })).toEqual({ build: 25, warning: '' });
    });

    it('starts at 1 with no build, or one reset to 0', () => {
        expect(nextBuild({}).build).toBe(1);
        expect(nextBuild({ build: null }).build).toBe(1);
        expect(nextBuild({ build: 0 }).build).toBe(1);
    });

    it('makes build 0 from -1, the lowest', () => {
        expect(nextBuild({ build: -1 })).toEqual({ build: 0, warning: '' });
    });

    it('treats a number below -1 as -1, with a warning', () => {
        const next = nextBuild({ build: -7 });
        expect(next.build).toBe(0);
        expect(next.warning).toContain('-7');
    });

    it('stops on a build that is not a whole number, rather than reuse numbers', () => {
        for (const build of ['12', 'abc', 3.5, true, [], {}]) {
            expect(() => nextBuild({ build })).toThrow(/"build" must be a whole number/);
        }
    });
});

describe('versionOf', () => {
    it('takes three whole numbers, with a suffix npm allows', () => {
        expect(versionOf({ version: '1.2.0' })).toBe('1.2.0');
        expect(versionOf({ version: ' 1.2.0-beta.1 ' })).toBe('1.2.0-beta.1');
        expect(versionOf({ version: '10.0.3+sha.1' })).toBe('10.0.3+sha.1');
    });

    it('is empty with no version, or no file', () => {
        expect(versionOf({})).toBe('');
        expect(versionOf(undefined)).toBe('');
    });

    it('stops on anything else', () => {
        for (const version of ['1.2', 'v1.2.0', '1.2.0.4', '', 1, null]) {
            expect(() => versionOf({ version })).toThrow(/"version" must be three whole numbers/);
        }
    });
});

describe('checkLabel', () => {
    it('takes any text, trimmed', () => {
        expect(checkLabel('  iOS beta ')).toBe('iOS beta');
        expect(checkLabel('Web (staging) #2')).toBe('Web (staging) #2');
        expect(checkLabel(undefined)).toBe('');
        expect(checkLabel('')).toBe('');
    });

    it('stops on a control character, more than 40 characters, or something not text', () => {
        expect(() => checkLabel('one\ntwo')).toThrow(/control character/);
        expect(() => checkLabel('a\tb')).toThrow(/control character/);
        expect(() => checkLabel('x'.repeat(41))).toThrow(/41 characters/);
        expect(checkLabel('x'.repeat(40))).toHaveLength(40);
        expect(() => checkLabel(5, '"buildLabel"')).toThrow(/"buildLabel" must be text/);
    });
});

describe('versionText', () => {
    it('reads v + version + . + build, then the label after a space', () => {
        expect(versionText({ version: '1.2.0', build: 25, label: 'android' })).toBe('v1.2.0.25 android');
        expect(versionText({ version: '1.2.0', build: 0, label: '' })).toBe('v1.2.0.0');
    });

    it('leaves the number out when there is none', () => {
        expect(versionText({ version: '1.2.0', build: null, label: '' })).toBe('v1.2.0');
        expect(versionText({ version: '1.2.0', build: null, label: 'iOS beta' })).toBe('v1.2.0 iOS beta');
    });

    it('is empty with no version', () => {
        expect(versionText({ version: '', build: 3, label: 'web' })).toBe('');
    });
});

describe('withBuild', () => {
    it('sets build right after version, everything else as it was', () => {
        const text = '{\n    "name": "tools",\n    "version": "1.0.0",\n    "scripts": {\n        "a": "b"\n    }\n}\n';
        expect(withBuild(text, 1)).toBe('{\n    "name": "tools",\n    "version": "1.0.0",\n    "build": 1,\n    "scripts": {\n        "a": "b"\n    }\n}\n');
    });

    it('replaces the build where it was, and keeps two-space indents and Windows line endings', () => {
        expect(withBuild('{\r\n  "version": "1.0.0",\r\n  "build": 4,\r\n  "buildLabel": "web"\r\n}', 5))
            .toBe('{\r\n  "version": "1.0.0",\r\n  "build": 5,\r\n  "buildLabel": "web"\r\n}\r\n');
    });
});

describe('buildFromEnv', () => {
    it('takes a whole number from 0', () => {
        expect(buildFromEnv('25')).toBe(25);
        expect(buildFromEnv('0')).toBe(0);
    });

    it('is null for none or anything else', () => {
        for (const value of [undefined, '', 'dev', '-1', '1.5', '07']) expect(buildFromEnv(value)).toBeNull();
    });
});

describe('buildCommit', () => {
    const git = (head: string, status: string, ok = true) => vi.fn((_cmd: string, args: string[]) =>
        args[0] === 'rev-parse' ? { status: ok ? 0 : 128, stdout: head } : { status: 0, stdout: status });

    it('is the 8-character commit', () => {
        expect(buildCommit('/repo', git('533b6d02\n', ''))).toBe('533b6d02');
    });

    it('adds +changes when other files are changed, leaving custom/package.json out', () => {
        const run = git('533b6d02\n', ' M src/app/x.ts\n');
        expect(buildCommit('/repo', run)).toBe('533b6d02+changes');
        expect(run.mock.calls[1][1]).toContain(':(exclude)custom/package.json');
    });

    it('is empty outside a git checkout', () => {
        expect(buildCommit('/repo', git('', '', false))).toBe('');
    });
});

describe('with a custom/package.json', () => {
    let root: string;
    const write = (pkg: unknown) => writeFileSync(join(root, 'custom/package.json'), typeof pkg === 'string' ? pkg : JSON.stringify(pkg, null, 2) + '\n');
    const noGit = () => ({ status: 128, stdout: '' });

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'arc-version-'));
        mkdirSync(join(root, 'custom'));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    describe('readAppPackage', () => {
        it('is null with no file', () => {
            expect(readAppPackage(root)).toBeNull();
        });

        it('stops on a file that is not a JSON object', () => {
            write('{ "version": ');
            expect(() => readAppPackage(root)).toThrow(/not valid JSON/);
            write('[1]');
            expect(() => readAppPackage(root)).toThrow(/JSON object/);
        });
    });

    describe('appVersion', () => {
        it('is empty with no file, as in Arc CMS itself', () => {
            rmSync(join(root, 'custom'), { recursive: true });
            expect(appVersion({ root, env: {}, run: noGit })).toEqual({ text: '', version: '', build: null, label: '', commit: '' });
        });

        it('reads the version and label from the file, the number from VITE_ARC_BUILD', () => {
            write({ version: '1.2.0', build: 24, buildLabel: 'web' });
            expect(appVersion({ root, env: { VITE_ARC_BUILD: '25' }, run: noGit }))
                .toEqual({ text: 'v1.2.0.25 web', version: '1.2.0', build: 25, label: 'web', commit: '' });
        });

        it('has no number on the dev server, whatever the file says', () => {
            write({ version: '1.2.0', build: 24 });
            expect(appVersion({ root, env: {}, run: noGit }).text).toBe('v1.2.0');
        });

        it('takes ARC_BUILD_LABEL over buildLabel, even empty', () => {
            write({ version: '1.2.0', buildLabel: 'web' });
            expect(appVersion({ root, env: { ARC_BUILD_LABEL: 'android' }, run: noGit }).label).toBe('android');
            expect(appVersion({ root, env: { ARC_BUILD_LABEL: '' }, run: noGit }).text).toBe('v1.2.0');
        });

        it('stops on a bad version or label', () => {
            write({ version: '1.2' });
            expect(() => appVersion({ root, env: {}, run: noGit })).toThrow(/"version"/);
            write({ version: '1.2.0', buildLabel: 'a\nb' });
            expect(() => appVersion({ root, env: {}, run: noGit })).toThrow(/"buildLabel" has a control character/);
        });
    });

    describe('planBuild', () => {
        it('takes the next number and hands it to Vite, with the heap and the label', () => {
            write({ version: '1.2.0', build: 24, buildLabel: 'web' });
            const plan = planBuild({ root, argv: [], env: { VITE_ARC_BUILD: '3', NODE_OPTIONS: '--trace-warnings' } });
            expect(plan).toMatchObject({ build: 25, label: 'web', text: 'v1.2.0.25 web' });
            expect(plan.env).toMatchObject({ VITE_ARC_BUILD: '25', ARC_BUILD_LABEL: 'web', NODE_OPTIONS: '--max-old-space-size=8192 --trace-warnings' });
        });

        it('builds with no number, and none left in the shell, with --no-bump or ARC_NO_BUMP', () => {
            write({ version: '1.2.0', build: 24 });
            for (const [argv, env] of [[['--no-bump'], {}], [[], { ARC_NO_BUMP: '1' }]] as const) {
                const plan = planBuild({ root, argv, env: { ...env, VITE_ARC_BUILD: '9' } });
                expect(plan).toMatchObject({ build: null, text: 'v1.2.0' });
                expect(plan.env).not.toHaveProperty('VITE_ARC_BUILD');
                expect(plan.env).not.toHaveProperty('ARC_NO_BUMP');
            }
        });

        it('takes --label over ARC_BUILD_LABEL over buildLabel', () => {
            write({ version: '1.2.0', buildLabel: 'web' });
            expect(planBuild({ root, argv: [], env: { ARC_BUILD_LABEL: 'ios' } }).label).toBe('ios');
            expect(planBuild({ root, argv: ['--label=android'], env: { ARC_BUILD_LABEL: 'ios' } }).label).toBe('android');
            expect(planBuild({ root, argv: ['--label='], env: {} }).text).toBe('v1.2.0.1');
        });

        it('numbers nothing with no file or no version', () => {
            expect(planBuild({ root, argv: [], env: {} })).toMatchObject({ build: null, text: '' });
            write({ name: 'tools', scripts: {} });
            expect(planBuild({ root, argv: [], env: {} })).toMatchObject({ build: null, text: '' });
        });

        it('does not read a bad build at all with --no-bump', () => {
            write({ version: '1.2.0', build: 'oops' });
            expect(() => planBuild({ root, argv: [], env: {} })).toThrow(/"build" must be a whole number/);
            expect(planBuild({ root, argv: ['--no-bump'], env: {} }).text).toBe('v1.2.0');
        });
    });

    describe('runWebsiteBuild', () => {
        const pkgPath = () => join(root, 'custom/package.json');
        const log = vi.fn();
        beforeEach(() => {
            mkdirSync(join(root, 'dist/client'), { recursive: true });
            mkdirSync(join(root, 'dist/analog/public'), { recursive: true });
            writeFileSync(join(root, 'dist/client/index.html'), '<html>shell</html>');
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        });
        afterEach(() => vi.restoreAllMocks());

        it('writes the number back after a build that succeeds, and copies the shell', () => {
            write({ version: '1.2.0', build: 24 });
            const run = vi.fn(() => ({ status: 0 }));
            expect(runWebsiteBuild({ root, argv: [], env: {}, run, log })).toBe(0);
            expect(run.mock.calls[0][1]).toEqual([expect.stringMatching(/vite[\\/]bin[\\/]vite\.js$/), 'build']);
            expect((run.mock.calls[0] as unknown[])[2]).toMatchObject({ env: { VITE_ARC_BUILD: '25' } });
            expect(JSON.parse(readFileSync(pkgPath(), 'utf8')).build).toBe(25);
            expect(readFileSync(join(root, 'dist/analog/public/__shell.html'), 'utf8')).toBe('<html>shell</html>');
        });

        it('keeps an edit made to the file while the build ran', () => {
            write({ version: '1.2.0', build: 24 });
            const run = vi.fn(() => { write({ version: '1.3.0', build: 24 }); return { status: 0 }; });
            runWebsiteBuild({ root, argv: [], env: {}, run, log });
            expect(JSON.parse(readFileSync(pkgPath(), 'utf8'))).toEqual({ version: '1.3.0', build: 25 });
        });

        it('says what to set by hand when the file broke while the build ran', () => {
            write({ version: '1.2.0', build: 24 });
            const run = vi.fn(() => { write('{ broken'); return { status: 0 }; });
            expect(runWebsiteBuild({ root, argv: [], env: {}, run, log })).toBe(1);
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Set "build" to 25 by hand'));
        });

        it('leaves the file as it was when the build fails', () => {
            write({ version: '1.2.0', build: 24 });
            const before = readFileSync(pkgPath(), 'utf8');
            expect(runWebsiteBuild({ root, argv: [], env: {}, run: () => ({ status: 2 }), log })).toBe(2);
            expect(readFileSync(pkgPath(), 'utf8')).toBe(before);
            expect(existsSync(join(root, 'dist/analog/public/__shell.html'))).toBe(false);
        });

        it('leaves the file alone with --no-bump', () => {
            write({ version: '1.2.0', build: 24 });
            const before = readFileSync(pkgPath(), 'utf8');
            expect(runWebsiteBuild({ root, argv: ['--no-bump'], env: {}, run: () => ({ status: 0 }), log })).toBe(0);
            expect(readFileSync(pkgPath(), 'utf8')).toBe(before);
        });

        it('builds nothing on a bad build number or an unknown option', () => {
            write({ version: '1.2.0', build: 'x' });
            const run = vi.fn(() => ({ status: 0 }));
            expect(runWebsiteBuild({ root, argv: [], env: {}, run, log })).toBe(1);
            write({ version: '1.2.0' });
            expect(runWebsiteBuild({ root, argv: ['--bump'], env: {}, run, log })).toBe(1);
            expect(run).not.toHaveBeenCalled();
        });
    });
});

describe('buildOptions and buildNodeOptions', () => {
    it('counts by default, and stops on an option it does not know', () => {
        expect(buildOptions([], {})).toEqual({ bump: true, label: undefined });
        expect(buildOptions([], { ARC_NO_BUMP: 'true' }).bump).toBe(false);
        // npm run build --no-bump --label=ios, with no `--`: npm keeps them as its own settings.
        expect(buildOptions([], { npm_config_bump: '', npm_config_label: 'ios' })).toEqual({ bump: false, label: 'ios' });
        expect(buildOptions([], { npm_config_bump: 'true' }).bump).toBe(true);
        expect(() => buildOptions(['--label', 'x'], {})).toThrow(/does not know --label/);
    });

    it('gives the build 8 GB, and a NODE_OPTIONS the caller sets comes last, so it wins', () => {
        expect(buildNodeOptions({})).toBe('--max-old-space-size=8192');
        expect(buildNodeOptions({ NODE_OPTIONS: '--max-old-space-size=12288' })).toBe('--max-old-space-size=8192 --max-old-space-size=12288');
    });
});

describe('splitBuildFlags (npm run deploy, npm run build:project)', () => {
    it('takes --no-bump and --label off the arguments Firebase gets, for the website build', () => {
        expect(splitBuildFlags(['--only', 'hosting', '--no-bump', '--label=ios beta', '--project', 'default'])).toEqual({
            rest: ['--only', 'hosting', '--project', 'default'],
            env: { ARC_NO_BUMP: '1', ARC_BUILD_LABEL: 'ios beta' },
        });
        expect(splitBuildFlags(['--only', 'functions'])).toEqual({ rest: ['--only', 'functions'], env: {} });
    });
});
