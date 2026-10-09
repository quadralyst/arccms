/**
 * The build check that warns when an app page's address is also a language code
 * (scripts/vite-language-routes.ts, F18).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { languageRouteCheck, languageRouteClashes, pageFileSegments, routeFileSegments } from '../vite-language-routes';

const dirs: string[] = [];
function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'arc-lang-routes-'));
    dirs.push(dir);
    return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('routeFileSegments', () => {
    it('reads the first segment of each literal path', () => {
        const source = `export const CUSTOM_ROUTES: Routes = [
  { path: 'pay', loadComponent: () => import('./pay') },
  { path: "de/impressum", children: [{ path: '', component: X }] },
  { path: ':lang/x' }, { path: '**' },
];`;
        expect(routeFileSegments(source)).toEqual(['pay', 'de']);
    });
});

describe('pageFileSegments', () => {
    it('reads the addresses the file-based pages give, inside (group) folders too', () => {
        const dir = tempDir();
        mkdirSync(join(dir, 'fr'));
        mkdirSync(join(dir, '(learning)'));
        mkdirSync(join(dir, '[slug]'));
        writeFileSync(join(dir, 'learn.page.ts'), '');
        writeFileSync(join(dir, 'index.page.ts'), '');
        writeFileSync(join(dir, '(learning)', 'hi.page.ts'), '');
        writeFileSync(join(dir, 'it.lesson.page.ts'), '');
        writeFileSync(join(dir, 'notes.md'), '');
        expect(pageFileSegments(dir).sort()).toEqual(['fr', 'hi', 'it', 'learn']);
    });

    it('is empty when the folder does not exist', () => {
        expect(pageFileSegments(join(tempDir(), 'missing'))).toEqual([]);
    });
});

describe('languageRouteClashes', () => {
    it('warns once for each address that is a language code in the catalogue', () => {
        const warnings = languageRouteClashes(['pay', 'de', 'DE', 'learn']);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('/de');
        expect(warnings[0]).toContain('German');
    });

    it('says nothing for addresses that are not', () => {
        expect(languageRouteClashes(['pay', 'learn', 'signup'])).toEqual([]);
    });
});

describe('languageRouteCheck', () => {
    it("warns through Vite when the build starts, from the app's routes and pages", () => {
        const root = tempDir();
        mkdirSync(join(root, 'src/custom/pages'), { recursive: true });
        writeFileSync(join(root, 'src/custom/routes.ts'), `export const CUSTOM_ROUTES = [{ path: 'es/tienda' }];`);
        writeFileSync(join(root, 'src/custom/pages/ja.page.ts'), '');
        const warn = vi.fn();
        (languageRouteCheck(root).buildStart as (this: unknown) => void).call({ warn });
        expect(warn).toHaveBeenCalledTimes(2);
        expect(warn.mock.calls.map(([message]) => message).join(' ')).toMatch(/\/es.*\/ja|\/ja.*\/es/s);
    });

    it('is quiet for the starter files Arc CMS ships', () => {
        const warn = vi.fn();
        (languageRouteCheck().buildStart as (this: unknown) => void).call({ warn });
        expect(warn).not.toHaveBeenCalled();
    });
});
