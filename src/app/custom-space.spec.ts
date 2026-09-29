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
import { CUSTOM_USER_DASHBOARD } from '../custom/user-dashboard';
import customEn from '../custom/i18n/en.json';
import customHi from '../custom/i18n/hi.json';

const ROOT = resolve(__dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('custom space', () => {
    it('ships every starter file empty', () => {
        expect(CUSTOM_ROUTES).toEqual([]);
        expect(CUSTOM_NAV).toEqual([]);
        expect(CUSTOM_USER_DASHBOARD).toBeNull();
        // Specs always see every feature on (src/test/setup.ts), so read the file itself.
        expect(read('src/custom/features.ts')).toMatch(/^export const CUSTOM_FEATURES: FeatureChoice = \{\};$/m);
        expect(customEn).toEqual({});
        expect(customHi).toEqual({});
        expect(read('functions/src/custom/index.ts')).toMatch(/^export \{\};$/m);
        expect(read('functions/src/custom/search-sources.ts')).toMatch(/^export const SEARCH_COLLECTIONS: string\[\] = \[\];$/m);
        expect(read('functions/src/custom/search-sources.ts')).toMatch(/^export const CUSTOM_SEARCH_SOURCES: SearchSource\[\] = \[\];$/m);
    });

    describe('features', () => {
        it('resolves the app choice at build start, so a bad one stops the build', () => {
            const vite = read('vite.config.ts');
            expect(vite).toContain("import { CUSTOM_FEATURES } from './src/custom/features';");
            expect(vite).toContain('resolveFeatures(CUSTOM_FEATURES);');
        });

        it('turns off and on what the app lists', async () => {
            vi.resetModules();
            vi.doMock('../custom/features', () => ({ CUSTOM_FEATURES: { on: ['pwa'], off: ['payments'] } }));
            const { isOn } = await import('./core/features/features');
            expect(isOn('payments')).toBe(false);
            expect(isOn('content')).toBe(true);
            expect(isOn('pwa')).toBe(true);
            vi.doUnmock('../custom/features');
        });

        it('switches the PWA from the features, not pwa.ts', async () => {
            vi.resetModules();
            vi.doMock('../custom/features', () => ({ CUSTOM_FEATURES: { on: ['pwa'] } }));
            const { PWA } = await import('./core/pwa/pwa.service');
            expect(PWA.enabled).toBe(true);
            vi.doUnmock('../custom/features');
            expect(read('vite.config.ts')).toContain("resolvePwaConfig(CUSTOM_PWA, features.has('pwa'))");
        });
    });

    describe('member dashboard', () => {
        const dashboardRoute = (routes: { path?: string }[]) => routes.find((r) => r.path === 'user/dashboard') as { loadComponent: () => unknown };

        it('shows the core blank dashboard when the app names none', async () => {
            const { routes } = await import('./app.routes');
            const page = await dashboardRoute(routes).loadComponent();
            expect((page as { name: string }).name).toBe('UserDashboardComponent');
        });

        it("shows the app's own page when it names one", async () => {
            vi.resetModules();
            class LessonsHome {}
            vi.doMock('../custom/user-dashboard', () => ({ CUSTOM_USER_DASHBOARD: async () => LessonsHome }));
            const { routes } = await import('./app.routes');
            expect(await dashboardRoute(routes).loadComponent()).toBe(LessonsHome);
            vi.doUnmock('../custom/user-dashboard');
        });
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
            expect(read('src/shared/components/side-navbar/side-navbar.component.ts')).toContain('insertCustomNav(items, withoutFeaturesOff(CUSTOM_NAV))');
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
