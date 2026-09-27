import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { classify, group, main } from '../check-core.mjs';

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
            expect(out).toContain('docs/custom-code.md');
        });

        it('explains how to add Arc CMS as upstream when there is nothing to compare with', () => {
            const { code, out } = run();
            expect(code).toBe(0);
            expect(out).toContain('git remote add upstream');
        });
    });
});
