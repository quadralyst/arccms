import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { classify, followedUpstream, group, isArcCmsRepository, main } from '../check-core.mjs';

describe('check-core', () => {
    describe('classify', () => {
        it.each([
            ['src/custom/routes.ts', 'custom'],
            ['src/custom/pages/learn.page.ts', 'custom'],
            ['functions/src/custom/index.ts', 'custom'],
            ['firestore.app.rules', 'custom'],
            ['storage.app.rules', 'custom'],
            ['firestore.app.indexes.json', 'custom'],
            ['tests/rules/custom/children.spec.ts', 'custom'],
            ['custom/scripts/import-words.mjs', 'custom'],
            ['custom/data/words.csv', 'custom'],
            ['customer.md', 'core'],
            ['src/environments/environment.ts', 'install'],
            ['src/environments/environment.prod.ts', 'install'],
            ['src/environments/arc-install.ts', 'install'],
            ['package.json', 'review'],
            ['functions/package-lock.json', 'review'],
            ['src/app/app.routes.ts', 'core'],
            ['firestore.rules', 'core'],
            ['functions/src/all.ts', 'core'],
            ['src/customer/x.ts', 'core'],
        ])('%s is %s', (path, kind) => {
            expect(classify(path)).toBe(kind);
        });

        it('groups and sorts, without duplicates', () => {
            expect(group(['firestore.rules', 'src/custom/nav.ts', 'firestore.rules', 'package.json'])).toEqual({
                custom: ['src/custom/nav.ts'], install: [], review: ['package.json'], core: ['firestore.rules'],
            });
        });
    });

    describe('main, in a real repository', () => {
        let dir: string;
        const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
        const run = (...args: string[]) => {
            const log: string[] = [];
            const code = main(args, (line: string) => log.push(line), dir);
            return { code, out: log.join('\n') };
        };

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'check-core-'));
            git('init', '-q', '-b', 'main');
            git('config', 'user.email', 't@example.com');
            git('config', 'user.name', 'T');
            mkdirSync(join(dir, 'src', 'custom'), { recursive: true });
            writeFileSync(join(dir, 'firestore.rules'), 'core\n');
            writeFileSync(join(dir, 'src', 'custom', 'routes.ts'), 'export const CUSTOM_ROUTES = [];\n');
            git('add', '.');
            git('commit', '-q', '-m', 'arc cms');
            git('branch', 'arc-base');
        });
        afterEach(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        it('passes when only custom files changed, committed or not', () => {
            writeFileSync(join(dir, 'src', 'custom', 'routes.ts'), 'export const CUSTOM_ROUTES = [{ path: "learn" }];\n');
            git('commit', '-qam', 'app page');
            writeFileSync(join(dir, 'firestore.app.rules'), 'match /children/{id} {}\n');
            const { code, out } = run('--against', 'arc-base');
            expect(code).toBe(0);
            expect(out).toContain('No Arc CMS core file changed');
        });

        it('fails and names a changed core file, even an uncommitted one', () => {
            writeFileSync(join(dir, 'firestore.rules'), 'core, edited by the app\n');
            const { code, out } = run('--against', 'arc-base');
            expect(code).toBe(1);
            expect(out).toContain('firestore.rules');
            expect(out).toContain('docs/app/custom-space.html');
        });

        it('fails, and explains how to add Arc CMS as upstream, when there is nothing to compare with (review F)', () => {
            const { code, out } = run();
            expect(code).toBe(1);
            expect(out).toContain('git remote add upstream');
        });

        it('passes in Arc CMS itself, which has no upstream', () => {
            git('remote', 'add', 'origin', 'git@github.com:quadralyst/arccms.git');
            const { code, out } = run();
            expect(code).toBe(0);
            expect(out).toContain('Arc CMS itself');
        });

        it('tells Arc CMS itself from an app, whose upstream remote also points at Arc CMS', () => {
            expect(isArcCmsRepository(dir)).toBe(false); // no Arc CMS remote: an app, or a copy
            git('remote', 'add', 'origin', 'git@github.com:quadralyst/arccms.git');
            expect(isArcCmsRepository(dir)).toBe(true);
            git('remote', 'rename', 'origin', 'upstream');
            git('update-ref', 'refs/remotes/upstream/main', 'arc-base');
            expect(isArcCmsRepository(dir)).toBe(false);
        });

        it('does not call an app Arc CMS itself when --against names a branch it lacks', () => {
            git('remote', 'add', 'upstream', 'git@github.com:quadralyst/arccms.git');
            git('update-ref', 'refs/remotes/upstream/main', 'arc-base');
            const { code, out } = run('--against', 'upstream/nope');
            expect(code).toBe(1);
            expect(out).not.toContain('Arc CMS itself');
        });

        it('keeps scripts and data in the root custom folder as app files', () => {
            mkdirSync(join(dir, 'custom', 'data'), { recursive: true });
            writeFileSync(join(dir, 'custom', 'data', 'words.csv'), 'word\n');
            const { code } = run('--against', 'arc-base');
            expect(code).toBe(0);
        });

        describe('without --against', () => {
            // arc-base is where main stood; dev moved on, and the app was copied from dev.
            beforeEach(() => {
                git('update-ref', 'refs/remotes/upstream/main', 'arc-base');
                writeFileSync(join(dir, 'firestore.rules'), 'core, newer on dev\n');
                git('commit', '-qam', 'dev work');
                git('update-ref', 'refs/remotes/upstream/dev', 'HEAD');
                writeFileSync(join(dir, 'src', 'custom', 'routes.ts'), 'export const CUSTOM_ROUTES = [{ path: "game" }];\n');
                git('commit', '-qam', 'app page');
            });

            it('compares with the upstream branch the copy follows', () => {
                expect(followedUpstream(dir)).toBe('upstream/dev');
                const { code, out } = run();
                expect(code).toBe(0);
                expect(out).toContain('Comparing with upstream/dev');
            });

            it('compares with main when main is the closer one', () => {
                git('update-ref', 'refs/remotes/upstream/main', 'HEAD');
                expect(followedUpstream(dir)).toBe('upstream/main');
            });

            it('uses main when only main exists', () => {
                git('update-ref', '-d', 'refs/remotes/upstream/dev');
                const { code, out } = run();
                expect(out).toContain('Comparing with upstream/main');
                // dev's core edit is a change compared with main
                expect(code).toBe(1);
                expect(out).toContain('firestore.rules');
            });

            it('lets --against override the choice', () => {
                const { code, out } = run('--against', 'upstream/main');
                expect(code).toBe(1);
                expect(out).not.toContain('Comparing with');
            });
        });

        it('names a core file moved into the custom space (review F)', () => {
            mkdirSync(join(dir, 'src', 'custom', 'moved'), { recursive: true });
            git('mv', 'firestore.rules', 'src/custom/moved/firestore.rules');
            const { code, out } = run('--against', 'arc-base');
            expect(code).toBe(1);
            expect(out).toContain('firestore.rules');
        });
    });
});
