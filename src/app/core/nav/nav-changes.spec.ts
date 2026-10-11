import { describe, expect, it } from 'vitest';
import { applyNavChanges, navChangeLabels, navChangeProblems, type NavChange } from './nav-changes';
import { ADMIN_LOCKS, ADMIN_MENU_IDS, coreAdminItems } from './admin-menu';
import { MEMBER_MENU_IDS, memberMenu } from './member-menu';
import { menuIds, withoutFeaturesOff, type MenuItem } from './menu';

const menu = (): MenuItem[] => [
    { id: 'dashboard', label: 'Dashboard', route: '/admin/dashboard', allowRoles: ['admin'] },
    { id: 'media', label: 'Media', route: '/admin/media', allowRoles: ['admin'] },
    { id: 'audience', label: 'Audience', allowRoles: ['admin'], subItems: [
        { id: 'contacts', label: 'Contacts', route: '/admin/contacts' },
        { id: 'lists', label: 'Lists', route: '/admin/lists' },
    ] },
    { id: 'about', label: 'About', externalUrl: 'https://arccms.com/about', allowRoles: ['admin'] },
    { id: 'profile', label: 'Profile', route: '/admin/profile', allowRoles: ['admin', 'user'] },
    { id: 'logout', label: 'Logout', route: '', allowRoles: ['admin', 'user'] },
];
const ids = (items: MenuItem[]) => items.map((i) => (i.subItems ? `${i.id}(${i.subItems.map((s) => s.id).join(',')})` : i.id));
const apply = (changes: NavChange[], role = 'admin') => applyNavChanges(menu(), changes, role, ADMIN_LOCKS);

describe('applyNavChanges', () => {
    it('changes nothing, and returns a copy, with no changes', () => {
        const items = menu();
        const result = applyNavChanges(items);
        expect(result).toEqual(menu());
        expect(result).not.toBe(items);
        expect(result[2].subItems).not.toBe(items[2].subItems);
    });

    it("changes an item's fields, leaving the core list alone", () => {
        const items = menu();
        const [dashboard] = applyNavChanges(items, [{ id: 'dashboard', route: '/admin/extension-dashboard', icon: 'fa-solid fa-chart-line', labelKey: 'custom.nav.home', queryParams: { tab: 'today' } }]);
        expect(dashboard).toEqual({ id: 'dashboard', label: 'Dashboard', labelKey: 'custom.nav.home', icon: 'fa-solid fa-chart-line', route: '/admin/extension-dashboard', queryParams: { tab: 'today' }, allowRoles: ['admin'] });
        expect(items[0].route).toBe('/admin/dashboard');
    });

    it('swaps an outside address for a page and back: an item opens one or the other', () => {
        const about = apply([{ id: 'about', route: '/admin/about' }]).find((i) => i.id === 'about')!;
        expect(about.route).toBe('/admin/about');
        expect(about.externalUrl).toBeUndefined();
        const media = apply([{ id: 'media', externalUrl: 'https://example.com/media' }]).find((i) => i.id === 'media')!;
        expect(media.externalUrl).toBe('https://example.com/media');
        expect(media.route).toBeUndefined();
    });

    it('changes, hides and moves sub-items too', () => {
        const result = apply([
            { id: 'contacts', label: 'People' },
            { id: 'lists', hide: true },
            { id: 'media', before: 'contacts' },
        ]);
        expect(ids(result)).toEqual(['dashboard', 'audience(media,contacts)', 'about', 'profile', 'logout']);
        expect(result[1].subItems![1].label).toBe('People');
    });

    it('hides an item', () => {
        expect(ids(apply([{ id: 'media', hide: true }]))).toEqual(['dashboard', 'audience(contacts,lists)', 'about', 'profile', 'logout']);
    });

    it('adds an item before or after another, or at the end', () => {
        const result = apply([
            { add: { id: 'reports', label: 'Reports', route: '/admin/reports' }, after: 'dashboard' },
            { add: { id: 'lessons', label: 'Lessons', route: '/admin/lessons' }, before: 'profile' },
            { add: { id: 'segments', label: 'Segments', route: '/admin/segments' }, after: 'lists' },
            { add: { id: 'help', label: 'Help', externalUrl: 'https://example.com/help' } },
        ]);
        expect(ids(result)).toEqual(['dashboard', 'reports', 'media', 'audience(contacts,lists,segments)', 'about', 'lessons', 'profile', 'logout', 'help']);
    });

    it('moves an item before or after another', () => {
        expect(ids(apply([{ id: 'about', after: 'dashboard' }, { id: 'dashboard', before: 'logout' }])))
            .toEqual(['about', 'media', 'audience(contacts,lists)', 'profile', 'dashboard', 'logout']);
    });

    it('never puts a group inside another group', () => {
        const added = apply([{ add: { id: 'classroom', label: 'Classroom', subItems: [{ id: 'lessons', label: 'Lessons', route: '/admin/lessons' }] }, after: 'contacts' }]);
        expect(ids(added).at(-1)).toBe('classroom(lessons)');
        expect(ids(apply([{ id: 'audience', after: 'dashboard' }, { id: 'audience', after: 'contacts' }])))
            .toEqual(['dashboard', 'audience(contacts,lists)', 'media', 'about', 'profile', 'logout']);
    });

    it("applies a change only to the roles it names, and to everyone without roles", () => {
        const changes: NavChange[] = [
            { id: 'media', hide: true, roles: ['editor'] },
            { add: { id: 'reports', label: 'Reports', route: '/admin/reports' }, after: 'dashboard', roles: ['admin', 'editor'] },
            { id: 'about', label: 'Help' },
        ];
        expect(ids(apply(changes, 'admin'))).toEqual(['dashboard', 'reports', 'media', 'audience(contacts,lists)', 'about', 'profile', 'logout']);
        expect(ids(apply(changes, 'editor'))).toEqual(['dashboard', 'reports', 'audience(contacts,lists)', 'about', 'profile', 'logout']);
        expect(ids(apply(changes, 'user'))).toEqual(ids(menu()));
        expect(ids(applyNavChanges(menu(), changes, undefined))).toEqual(ids(menu()));
        for (const role of ['admin', 'editor', 'user']) expect(apply(changes, role).find((i) => i.id === 'about')!.label).toBe('Help');
    });

    it('ignores a change to an id the menu does not have, an add of an id it has, and a move to a missing place', () => {
        const result = apply([
            { id: 'no-such-item', hide: true },
            { id: 'media', route: '/admin/x', after: 'no-such-item' },
            { add: { id: 'media', label: 'Twice', route: '/twice' } },
        ]);
        expect(ids(result)).toEqual(ids(menu()));
        expect(result[1]).toMatchObject({ label: 'Media', route: '/admin/x' });
        expect(ids(apply([{ add: { id: 'reports', label: 'Reports', route: '/admin/reports' }, after: 'no-such-item' }])).at(-1)).toBe('reports');
    });

    it('keeps an item of a feature that is off gone, whatever a change says', () => {
        const core: MenuItem[] = [
            { id: 'dashboard', label: 'Dashboard', route: '/admin/dashboard', allowRoles: ['admin'] },
            { id: 'products', label: 'Products', route: '/admin/products', allowRoles: ['admin'], feature: 'payments' },
        ];
        const off = (id: string) => id !== 'payments';
        const result = withoutFeaturesOff(applyNavChanges(withoutFeaturesOff(core, off), [
            { id: 'products', label: 'Shop', after: 'dashboard' },
            { add: { id: 'refunds', label: 'Refunds', route: '/admin/refunds', feature: 'payments' } },
        ]), off);
        expect(ids(result)).toEqual(['dashboard']);
    });

    it('never hides Profile or Logout, lets their roles only grow, and keeps Logout signing out', () => {
        const result = apply([
            { id: 'profile', hide: true },
            { id: 'logout', hide: true },
            { id: 'profile', allowRoles: ['editor'], route: '/admin/me' },
            { id: 'logout', allowRoles: [], route: '/elsewhere', externalUrl: 'https://example.com', queryParams: { a: 'b' }, label: 'Sign out' },
        ]);
        expect(result.find((i) => i.id === 'profile')).toEqual({ id: 'profile', label: 'Profile', route: '/admin/me', allowRoles: ['admin', 'user', 'editor'] });
        expect(result.find((i) => i.id === 'logout')).toEqual({ id: 'logout', label: 'Sign out', route: '', allowRoles: ['admin', 'user'] });
        // Moving them is fine: they stay in the menu.
        expect(ids(apply([{ id: 'logout', after: 'dashboard' }]))[1]).toBe('logout');
    });
});

describe('navChangeProblems', () => {
    const admin = (changes: NavChange[]) => navChangeProblems('admin', changes, { ids: ADMIN_MENU_IDS, locks: ADMIN_LOCKS });

    it('accepts the changes the docs show', () => {
        expect(admin([
            { id: 'dashboard', route: '/admin/extension-dashboard' },
            { id: 'media', hide: true },
            { id: 'users', labelKey: 'custom.nav.people' },
            { add: { id: 'reports', label: 'Reports', route: '/admin/reports', allowRoles: ['admin', 'editor'] }, after: 'dashboard' },
            { id: 'reports', hide: true, roles: ['editor'] },
            { id: 'about', externalUrl: 'https://example.com/about' },
            { id: 'logout', label: 'Sign out', after: 'settings' },
        ])).toEqual([]);
        expect(navChangeProblems('member', [
            { id: 'premium', hide: true, roles: ['user'] },
            { add: { id: 'lessons', label: 'Lessons', labelKey: 'custom.nav.lessons', route: '/learn' }, before: 'profile' },
        ], { ids: MEMBER_MENU_IDS })).toEqual([]);
    });

    it('names an id the menu does not have, with the valid ids', () => {
        const [problem] = admin([{ id: 'dashbord', hide: true }]);
        expect(problem).toContain("admin 'dashbord': not an item of the admin menu");
        expect(problem).toContain('valid ids: dashboard, signup-forms, media, content,');
        expect(admin([{ id: 'media', after: 'dashbord' }])[0]).toContain("before/after 'dashbord' is not an item of the admin menu");
        expect(admin([{ add: { id: 'reports', label: 'Reports', route: '/admin/reports' }, before: 'nope' }])[0]).toContain("admin add 'reports': before/after 'nope'");
    });

    it('fails a route that is not a path on this site, and an outside address that is not https', () => {
        expect(admin([
            { id: 'dashboard', route: 'admin/home' },
            { id: 'media', route: '//evil.example/x' },
            { id: 'about', externalUrl: 'http://example.com' },
            { add: { id: 'docs', label: 'Docs', externalUrl: 'javascript:alert(1)' } },
            { add: { id: 'group', label: 'Group', subItems: [{ id: 'x', label: 'X', route: 'x' }] } },
        ])).toEqual([
            "admin 'dashboard': route 'admin/home' is not a path on this site starting with /",
            "admin 'media': route '//evil.example/x' is not a path on this site starting with /",
            "admin 'about': externalUrl 'http://example.com' is not an https:// address",
            "admin add 'docs': externalUrl 'javascript:alert(1)' is not an https:// address",
            "admin add 'group': route 'x' is not a path on this site starting with /",
        ]);
    });

    it('fails hiding Profile or Logout, or sending Logout elsewhere', () => {
        expect(admin([{ id: 'profile', hide: true }, { id: 'logout', route: '/bye' }])).toEqual([
            "admin 'profile': this item cannot be hidden: people must always be able to reach their profile and sign out",
            "admin 'logout': route cannot be changed on this item: it always does the same thing",
        ]);
    });

    it('fails an add without an id or label, a repeated id, both before and after, and empty roles', () => {
        expect(admin([
            { add: { label: 'No id' } as never },
            { add: { id: 'media', label: 'Media again', route: '/m' } },
            { add: { id: 'x', label: '', route: '/x' } },
            { id: 'media', before: 'users', after: 'users' },
            { id: 'users', hide: true, roles: [] },
        ])).toEqual([
            'admin add: the new item needs an id',
            "admin add 'media': the menu already has an item with this id",
            "admin add 'x': the new item needs a label",
            "admin 'media': give before or after, not both",
            "admin 'users': roles must list at least one role, or be left out for every role",
        ]);
    });

    it('lists the label keys the changes bring, for the translation checks', () => {
        expect(navChangeLabels([
            { id: 'users', labelKey: 'custom.nav.people' },
            { id: 'media', hide: true },
            { add: { id: 'reports', label: 'Reports', labelKey: 'custom.nav.reports' } },
        ]).map((i) => i.labelKey)).toEqual(['custom.nav.people', 'custom.nav.reports']);
    });
});

describe('the core menus', () => {
    it('give every core admin item a unique id', () => {
        expect(new Set(ADMIN_MENU_IDS).size).toBe(ADMIN_MENU_IDS.length);
        expect(ADMIN_MENU_IDS).toEqual(expect.arrayContaining(['dashboard', 'users', 'media', 'content', 'profile', 'logout']));
        const withoutId = (items: MenuItem[]): string[] => items.flatMap((i) => [...(i.id ? [] : [i.label]), ...withoutId(i.subItems ?? [])]);
        expect(withoutId(coreAdminItems())).toEqual([]);
    });

    it('give every core member item a unique id', () => {
        expect(MEMBER_MENU_IDS).toEqual(['home', 'dashboard', 'payments', 'account', 'premium', 'profile', 'plans']);
    });

    it("apply the app's member changes for the person's role", () => {
        const changes: NavChange[] = [
            { id: 'premium', hide: true, roles: ['user'] },
            { add: { id: 'lessons', label: 'Lessons', route: '/learn' }, before: 'profile' },
            { add: { id: 'staff', label: 'Staff room', route: '/staff', allowRoles: ['teacher'] } },
        ];
        const state = { home: null, memberPages: true };
        expect(menuIds(memberMenu({ ...state, role: 'user' }, changes))).toEqual(['dashboard', 'payments', 'account', 'lessons', 'profile', 'plans']);
        expect(menuIds(memberMenu({ ...state, role: 'teacher' }, changes))).toEqual(['dashboard', 'payments', 'account', 'premium', 'lessons', 'profile', 'plans', 'staff']);
        expect(menuIds(memberMenu({ ...state, role: 'user' }, changes, () => false))).toEqual(['dashboard', 'lessons', 'profile']);
    });
});
