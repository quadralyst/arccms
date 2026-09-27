/**
 * The custom space (docs/custom-code.md): each plug point where Arc CMS reads the
 * app's own files, proven with sample content while the shipped files stay empty.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeTranslations } from './core/i18n/translation.loader';
import { insertCustomNav, type MenuItem } from '../shared/components/side-navbar/side-navbar.component';
import { CUSTOM_ROUTES } from '../custom/routes';
import { CUSTOM_NAV } from '../custom/nav';
import customEn from '../custom/i18n/en.json';
import customHi from '../custom/i18n/hi.json';

const ROOT = resolve(__dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('custom space', () => {
    it('ships every starter file empty', () => {
        expect(CUSTOM_ROUTES).toEqual([]);
        expect(CUSTOM_NAV).toEqual([]);
        expect(customEn).toEqual({});
        expect(customHi).toEqual({});
        expect(read('functions/src/custom/index.ts')).toMatch(/^export \{\};$/m);
    });

    describe('routes', () => {
        it('adds the app routes after every core route', async () => {
            vi.resetModules();
            vi.doMock('../custom/routes', () => ({ CUSTOM_ROUTES: [{ path: 'learn' }] }));
            const { routes } = await import('./app.routes');
            expect(routes[routes.length - 1]).toEqual({ path: 'learn' });
            vi.doUnmock('../custom/routes');
        });

        it('lets the page scanner find src/custom/pages', () => {
            expect(read('vite.config.ts')).toContain("additionalPagesDirs: ['/src/custom/pages']");
        });
    });

    describe('admin menu', () => {
        const core = (): MenuItem[] => [{ label: 'Dashboard' }, { label: 'Settings' }, { label: 'Profile' }, { label: 'Logout' }];

        it('puts the app items before Profile', () => {
            const items = insertCustomNav(core(), [{ label: 'Lessons', route: '/admin/lessons' }]);
            expect(items.map((i) => i.label)).toEqual(['Dashboard', 'Settings', 'Lessons', 'Profile', 'Logout']);
        });

        it('adds them at the end when there is no Profile, and changes nothing when empty', () => {
            expect(insertCustomNav([{ label: 'A' }], [{ label: 'B' }]).map((i) => i.label)).toEqual(['A', 'B']);
            expect(insertCustomNav(core(), []).map((i) => i.label)).toEqual(['Dashboard', 'Settings', 'Profile', 'Logout']);
        });

        it('is wired into the side menu', () => {
            expect(read('src/shared/components/side-navbar/side-navbar.component.ts')).toContain('insertCustomNav(items, CUSTOM_NAV)');
        });
    });

    describe('translations', () => {
        it('adds the app keys and rewords core ones, nested objects merged key by key', () => {
            const core = { admin: { nav: { users: 'Users', settings: 'Settings' } }, common: { save: 'Save' } };
            const custom = { admin: { nav: { users: 'Parents' } }, lessons: { title: 'Lessons' } };
            expect(mergeTranslations(core, custom)).toEqual({
                admin: { nav: { users: 'Parents', settings: 'Settings' } },
                common: { save: 'Save' },
                lessons: { title: 'Lessons' },
            });
        });

        it('leaves the core alone without a custom file', () => {
            const core = { a: 'b' };
            expect(mergeTranslations(core, undefined)).toBe(core);
        });

        it('keeps the custom files in step: every English key has a Hindi one, and no extras', () => {
            const keys = (node: unknown, prefix = ''): string[] =>
                node && typeof node === 'object'
                    ? Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
                    : [prefix];
            const en = keys(customEn).filter(Boolean).sort();
            const hi = keys(customHi).filter(Boolean).sort();
            expect(hi).toEqual(en);
        });
    });

    it('loads the app styles after every other stylesheet', () => {
        const html = read('index.html');
        const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>|<link[^>]+stylesheet"[^>]*>/g)].map((m) => m[0]);
        expect(links[links.length - 1]).toContain('/src/custom/styles.css');
    });

    describe('functions', () => {
        it('deploys the app functions under their own group', () => {
            expect(read('functions/src/all.ts')).toContain("export * as custom from './custom/index.js';");
        });

        it('checks the app callables after a deploy', () => {
            const probe = read('functions/scripts/check-callable-access.sh');
            expect(probe).toContain('src/custom/public-callables.txt');
            expect(probe).toContain('CALLABLES+=("custom-$name")');
        });
    });
});
