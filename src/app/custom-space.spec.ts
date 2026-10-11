/**
 * The custom space (docs/app/custom-space.html): each plug point where Arc CMS reads the
 * app's own files, proven with sample content while the shipped files stay empty.
 */
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { isArcCmsRepository } from '../../scripts/check-core.mjs';
// @ts-expect-error: plain ESM script without type declarations
import { CUSTOM_STARTERS, isAppSpec } from '../../scripts/custom-starters.mjs';
import { mergeTranslations } from './core/i18n/translation.loader';
import { insertCustomNav, type MenuItem } from '../shared/components/side-navbar/side-navbar.component';
import { customAdminKeys, flattenKeys } from './core/i18n/member-keys';
import { menuIds } from './core/nav/menu';
import { navChangeLabels, navChangeProblems, type NavChanges } from './core/nav/nav-changes';
import { ADMIN_LOCKS, ADMIN_MENU_IDS } from './core/nav/admin-menu';
import { MEMBER_MENU_IDS } from './core/nav/member-menu';
import coreEn from '../assets/i18n/en.json';
import customEn from '../custom/i18n/en.json';
import customHi from '../custom/i18n/hi.json';

const ROOT = resolve(__dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('custom space', () => {
    // Only Arc CMS ships them empty: an app fills them in, so in an app this would fail
    // on its first feature. Detected the way check:core detects Arc CMS itself.
    it.skipIf(!isArcCmsRepository(ROOT))('ships every starter file empty, and no other code there', async () => {
        // Specs see the shipped values (src/test/setup.ts), so read each real file.
        for (const { file, exports } of CUSTOM_STARTERS) {
            expect({ ...(await vi.importActual(resolve(ROOT, file))) }, file).toEqual(exports);
        }
        const code = (dir: string) => readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')).map((f) => `${dir}/${f}`);
        expect([...code('src/custom'), ...code('functions/src/custom')].sort()).toEqual(CUSTOM_STARTERS.map((s) => s.file).sort());
        expect(customEn).toEqual({});
        expect(customHi).toEqual({});
        // The app's website: Arc CMS ships nothing there, its defaults live in public/_site/.
        expect(existsSync(resolve(ROOT, 'src/custom/site'))).toBe(false);
        // CI workflows are the app's (check:core counts .github as custom): Arc CMS ships none.
        expect(existsSync(resolve(ROOT, '.github'))).toBe(false);
    });

    it("gives core specs the shipped starter files, whatever an app puts there, and the app's specs the real ones", () => {
        for (const { file } of CUSTOM_STARTERS) {
            const [setup, from] = file.startsWith('functions/')
                ? ['functions/src/__tests__/setup.ts', file.replace('functions/src/', '../').replace(/\.ts$/, '.js')]
                : ['src/test/setup.ts', file.replace('src/', '../').replace(/\.ts$/, '')];
            expect(read(setup), `${setup} stubs ${file}`).toContain(`vi.mock('${from}', (actual) => starter('${file}', actual));`);
        }
        expect(isAppSpec(resolve(ROOT, 'src/custom/pages/learn.spec.ts'))).toBe(true);
        expect(isAppSpec(resolve(ROOT, 'functions/src/custom/lessons.spec.ts'))).toBe(true);
        expect(isAppSpec(resolve(ROOT, 'custom/scripts/import.spec.ts'))).toBe(true);
        expect(isAppSpec(resolve(ROOT, 'src/app/custom-space.spec.ts'))).toBe(false);
        expect(isAppSpec(resolve(ROOT, 'src/customer/x.spec.ts'))).toBe(false);
    });

    it("lays the app's website (src/custom/site/) over Arc CMS's when the dev server and the build start", () => {
        expect(read('vite.config.ts')).toContain("import { arcSite } from './scripts/vite-arc-site';");
        expect(read('vite.config.ts')).toMatch(/^\s+arcSite\(\),$/m);
        expect(read('scripts/arc-site.mjs')).toContain("export const APP_SITE = 'src/custom/site';");
    });

    it("keeps the root custom folder for the app's scripts and data, with its tests in the suite", () => {
        expect(read('custom/README.md')).toContain('runAdminScript');
        expect(read('vitest.config.ts')).toContain("'custom/**/*.spec.ts'");
    });

    it("ignores node_modules at any depth, so the app's own tools (custom/package.json) leave nothing untracked", () => {
        const ignored = (path: string) => {
            try {
                execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: ROOT, stdio: 'ignore' });
                return true;
            } catch {
                return false;
            }
        };
        expect(ignored('custom/node_modules/left-pad/index.js')).toBe(true);
        expect(ignored('src/custom/tools/node_modules/x/index.js')).toBe(true);
        expect(ignored('node_modules')).toBe(true);
        expect(ignored('custom/package.json')).toBe(false);
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

    describe('app accounts', () => {
        it('keeps locked app accounts out of the member pages when the app says so', async () => {
            vi.resetModules();
            vi.doMock('../custom/app-accounts', () => ({ CUSTOM_APP_ACCOUNTS: { memberPages: false } }));
            const { memberPagesOpen } = await import('./core/app-accounts/app-account-lock');
            expect(memberPagesOpen({ by: 'app' })).toBe(false);
            expect(memberPagesOpen({ by: 'email' })).toBe(true);
            vi.doUnmock('../custom/app-accounts');
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
        const core = (): MenuItem[] => [{ id: 'dashboard', label: 'Dashboard' }, { id: 'settings', label: 'Settings' }, { id: 'profile', label: 'Profile' }, { id: 'logout', label: 'Logout' }];

        it('puts the app items before Profile', () => {
            const items = insertCustomNav(core(), [{ label: 'Lessons', route: '/admin/lessons' }]);
            expect(items.map((i) => i.label)).toEqual(['Dashboard', 'Settings', 'Lessons', 'Profile', 'Logout']);
        });

        it('adds them at the end when there is no Profile, and changes nothing when empty', () => {
            expect(insertCustomNav([{ label: 'A' }], [{ label: 'B' }]).map((i) => i.label)).toEqual(['A', 'B']);
            expect(insertCustomNav(core(), []).map((i) => i.label)).toEqual(['Dashboard', 'Settings', 'Profile', 'Logout']);
        });

        it('is wired into the side menu', () => {
            const navbar = read('src/shared/components/side-navbar/side-navbar.component.ts');
            expect(navbar).toContain('insertCustomNav(items, withoutFeaturesOff(CUSTOM_NAV))');
            expect(navbar).toContain('applyNavChanges(items, CUSTOM_NAV_CHANGES.admin, this.authStore.currentUser()?.role, ADMIN_LOCKS)');
        });
    });

    describe('menu changes', () => {
        /** Every mistake in an app's CUSTOM_NAV_CHANGES, against the ids each menu has. */
        const problems = (changes: NavChanges, appItems: MenuItem[] = []) => [
            ...navChangeProblems('admin', changes.admin, { ids: [...ADMIN_MENU_IDS, ...menuIds(appItems)], locks: ADMIN_LOCKS }),
            ...navChangeProblems('member', changes.member, { ids: MEMBER_MENU_IDS }),
        ];

        // The app's real file: a change to an id core does not have, or a link that is not
        // a path or an https address, fails here rather than as a silent menu.
        it('checks src/custom/nav.ts: every id it names exists, every route is a path, every outside address https', async () => {
            const { CUSTOM_NAV, CUSTOM_NAV_CHANGES } = await vi.importActual<typeof import('../custom/nav')>('../custom/nav');
            expect(problems(CUSTOM_NAV_CHANGES, CUSTOM_NAV), 'fix CUSTOM_NAV_CHANGES in src/custom/nav.ts').toEqual([]);
        });

        it('reports a misspelt id with the valid ones, a route that is not a path and an address that is not https', () => {
            const found = problems({
                admin: [{ id: 'dashbord', route: '/admin/extension-dashboard' }, { id: 'media', route: 'admin/media' }],
                member: [{ add: { id: 'lessons', label: 'Lessons', externalUrl: 'http://example.com' }, before: 'profle' }],
            });
            expect(found).toHaveLength(4);
            expect(found[0]).toMatch(/^admin 'dashbord': not an item of the admin menu \(valid ids: dashboard, signup-forms, media, /);
            expect(found[1]).toBe("admin 'media': route 'admin/media' is not a path on this site starting with /");
            expect(found[2]).toBe("member add 'lessons': before/after 'profle' is not an item of the member menu (valid ids: home, dashboard, payments, account, premium, profile, plans, lessons)");
            expect(found[3]).toBe("member add 'lessons': externalUrl 'http://example.com' is not an https:// address");
        });

        it("lets a change name the app's own CUSTOM_NAV items by id", () => {
            expect(problems({ admin: [{ id: 'lessons', hide: true, roles: ['editor'] }] }, [{ id: 'lessons', label: 'Lessons' }])).toEqual([]);
        });

        it('has every core id in the docs, where apps look them up', () => {
            const admin = read('docs/app/admin-menu.html');
            const member = read('docs/app/member-area.html');
            expect(ADMIN_MENU_IDS.filter((id) => !admin.includes(`<code>${id}</code>`)), 'docs/app/admin-menu.html').toEqual([]);
            expect(MEMBER_MENU_IDS.filter((id) => !member.includes(`<code>${id}</code>`)), 'docs/app/member-area.html').toEqual([]);
        });

        it('is read by both menus', () => {
            expect(read('src/app/pages/user/user-shell.component.ts')).toContain('CUSTOM_NAV_CHANGES.member');
            expect(read('src/shared/components/side-navbar/side-navbar.component.ts')).toContain('CUSTOM_NAV_CHANGES.admin');
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

        /**
         * Hindi is an admin language, so the app's admin strings need it: rewording of a
         * core admin string, and the labels of its admin menu items (src/custom/nav.ts).
         * Its other strings may be ones only members see, which need Hindi only when the
         * app adds Hindi for its members (src/test/member-language-parity.spec.ts). A
         * missing one shows in English.
         */
        it('keeps the custom files in step: every admin string in English has a Hindi one, and Hindi has no extras', async () => {
            const { CUSTOM_NAV, CUSTOM_NAV_CHANGES } = await vi.importActual<typeof import('../custom/nav')>('../custom/nav');
            const en = new Set(flattenKeys(customEn));
            const hi = new Set(flattenKeys(customHi));
            const adminNav = [...CUSTOM_NAV, ...navChangeLabels(CUSTOM_NAV_CHANGES.admin)];
            expect(customAdminKeys(customEn, coreEn, adminNav).filter((key) => !hi.has(key)), 'add these to src/custom/i18n/hi.json').toEqual([]);
            expect([...hi].filter((key) => !en.has(key)), 'src/custom/i18n/hi.json has keys en.json lacks').toEqual([]);
        });

        // A menu label key no English file has shows as the bare key.
        it('finds every menu label key the app uses in English, its own or core', async () => {
            const { CUSTOM_NAV, CUSTOM_NAV_CHANGES } = await vi.importActual<typeof import('../custom/nav')>('../custom/nav');
            const english = new Set([...flattenKeys(coreEn), ...flattenKeys(customEn)]);
            const keys = (items: MenuItem[]): string[] => items.flatMap((i) => [...(i.labelKey ? [i.labelKey] : []), ...keys(i.subItems ?? [])]);
            const used = keys([...CUSTOM_NAV, ...navChangeLabels(CUSTOM_NAV_CHANGES.admin), ...navChangeLabels(CUSTOM_NAV_CHANGES.member)]);
            expect(used.filter((key) => !english.has(key)), 'add these to src/custom/i18n/en.json').toEqual([]);
        });

        it('counts as admin strings the rewording of core admin ones and the menu labels, never member strings', () => {
            const core = { admin: { nav: { users: 'Users' } }, user: { nav: { home: 'Home' } }, common: { actions: { cancel: 'Cancel' } } };
            const custom = { admin: { nav: { users: 'Parents' } }, user: { nav: { home: 'Start' } }, common: { actions: { cancel: 'Back' } }, lessons: { nav: 'Lessons', plan: 'Plan', title: 'Today' } };
            const nav: MenuItem[] = [{ label: 'Lessons', labelKey: 'lessons.nav', subItems: [{ label: 'Plan', labelKey: 'lessons.plan' }] }];
            expect(customAdminKeys(custom, core, nav)).toEqual(['admin.nav.users', 'lessons.nav', 'lessons.plan']);
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
