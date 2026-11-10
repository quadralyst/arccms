/**
 * One admin shell around every admin page (app.routes.ts): moving between pages keeps it,
 * with the side panel's scroll, open groups and reads. Before, each page had a parent of its
 * own, which destroyed and rebuilt the whole shell on every move.
 *
 * The first half runs the real route table over stand-in pages. The second runs the real
 * shell and panel, without zone.js as in the app.
 */
import { BreakpointObserver, type BreakpointState } from '@angular/cdk/layout';
import { Component, DestroyRef, inject, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatDrawer } from '@angular/material/sidenav';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, Router, RouterOutlet, type Route, type Routes } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../app.routes';
import { roleGuard } from '../guards/role.guard';
import { SiteIdentityService } from '../core/services/site-identity.service';
import NavbarComponent from '../../shared/components/side-navbar/side-navbar.component';
import { ToastService } from '../../shared/services/toast.service';
import { AuthState } from './(auth)/auth.store';
import { WaitlistAdminStore } from './admin/(waitlists)/waitlist.store';
import { ContentTypesStore } from './admin/contents/content-types/content-types.store';

let shellsBuilt = 0;
let shellsDestroyed = 0;

@Component({ standalone: true, imports: [RouterOutlet], template: '<router-outlet />' })
class ShellStub {
    constructor() {
        shellsBuilt++;
        inject(DestroyRef).onDestroy(() => shellsDestroyed++);
    }
}

@Component({ standalone: true, imports: [RouterOutlet], template: '<router-outlet />' })
class PageStub {}

@Component({ standalone: true, imports: [RouterOutlet], template: '<router-outlet />' })
class RootStub {}

const adminRoute = routes.find((r) => r.path === 'admin')!;
const unauthorized = routes.find((r) => r.path === 'admin/unauthorized')!;

/** The same paths, titles and redirects, over a stand-in page; the guards stay only when asked. */
function standIn(route: Route, guards: boolean): Route {
    const { loadComponent, canActivate, children, ...rest } = route;
    return {
        ...rest,
        ...(loadComponent ? { component: PageStub } : {}),
        ...(guards && canActivate ? { canActivate } : {}),
        ...(children ? { children: children.map((child) => standIn(child, guards)) } : {}),
    };
}

/** The real admin table over stand-ins, with what follows it in the app: other routes, then not found. */
function table(guards = false, after: Routes = []): Routes {
    return [
        standIn(unauthorized, guards),
        { ...standIn(adminRoute, guards), component: ShellStub },
        ...after,
        { path: '**', component: RootStub },
    ];
}

async function start(list: Routes, providers: unknown[] = []) {
    TestBed.configureTestingModule({ providers: [provideRouter(list), ...(providers as never[])] });
    const fixture = TestBed.createComponent(RootStub);
    fixture.autoDetectChanges();
    return TestBed.inject(Router);
}

const PAGES = [
    '/admin/dashboard', '/admin/media', '/admin/users', '/admin/users/add', '/admin/users/edit/u1', '/admin/contacts',
    '/admin/lists', '/admin/lists/waitlist-f1', '/admin/contact-tags', '/admin/contact-fields', '/admin/app-users',
    '/admin/email/brand-kit', '/admin/email/composer', '/admin/email/broadcasts', '/admin/email-logs', '/admin/sms-logs',
    '/admin/feedback', '/admin/messages', '/admin/products', '/admin/transactions', '/admin/data/export-data',
    '/admin/data/import-files', '/admin/profile', '/admin/settings/about', '/admin/settings/email', '/admin/waitlists',
    '/admin/waitlists/dashboard/f1', '/admin/waitlists/tags', '/admin/contents/content-types',
    '/admin/contents/content-types/add', '/admin/contents/content-types/edit/t1', '/admin/contents/content-types/tags',
    '/admin/contents/content-types/tags/edit/g1', '/admin/contents/blog', '/admin/contents/blog/add',
    '/admin/contents/blog/edit/c1', '/admin/authors', '/admin/search', '/admin/notifications',
];

describe('the admin routes', () => {
    beforeEach(() => {
        shellsBuilt = 0;
        shellsDestroyed = 0;
    });

    it('builds the shell once, and keeps it, across every admin page', async () => {
        const router = await start(table());
        for (const url of PAGES) {
            await router.navigateByUrl(url);
            expect(router.url, url).toBe(url);
        }
        expect(shellsBuilt).toBe(1);
        expect(shellsDestroyed).toBe(0);
    });

    it('keeps the redirects inside the admin: /admin, /admin/contents, and the settings and data pages', async () => {
        const router = await start(table());
        for (const [from, to] of [
            ['/admin', '/admin/dashboard'],
            ['/admin/contents', '/admin/contents/content-types'],
            ['/admin/settings', '/admin/settings/about'],
            ['/admin/data', '/admin/data/export-data'],
            ['/admin/email', '/admin/email/brand-kit'],
        ]) {
            await router.navigateByUrl(from);
            expect(router.url, from).toBe(to);
        }
        expect(shellsBuilt).toBe(1);
    });

    it('never draws the shell around the 403 page', async () => {
        const router = await start(table());
        await router.navigateByUrl('/admin/unauthorized');
        expect(router.url).toBe('/admin/unauthorized');
        expect(shellsBuilt).toBe(0);
    });

    it("lets a URL it does not know fall through, so an app's own admin page still opens", async () => {
        const router = await start(table(false, [{ path: 'admin/lessons', component: PageStub, title: 'Lessons' }]));
        await router.navigateByUrl('/admin/lessons');
        expect(router.routerState.snapshot.root.firstChild?.routeConfig?.path).toBe('admin/lessons');
        await router.navigateByUrl('/admin/nothing-here');
        expect(router.routerState.snapshot.root.firstChild?.routeConfig?.path).toBe('**');
        expect(shellsBuilt).toBe(0);
    });

    it('checks the role on every page, not only on entering the shell', async () => {
        const role = signal('admin');
        const router = await start(table(true), [
            { provide: AuthState, useValue: { recordReady: async () => ({ role: role() }) } },
            { provide: ToastService, useValue: { openCustomSnackbar: vi.fn() } },
        ]);
        await router.navigateByUrl('/admin/settings/about');
        expect(router.url).toBe('/admin/settings/about');
        expect(shellsBuilt).toBe(1);

        role.set('user');
        await router.navigateByUrl('/admin/users');
        await vi.waitFor(() => expect(router.url).toBe('/admin/unauthorized'));
        expect(shellsDestroyed).toBe(1);
    });

    it('never draws the shell for someone without the role', async () => {
        const router = await start(table(true), [
            { provide: AuthState, useValue: { recordReady: async () => ({ role: 'user' }) } },
            { provide: ToastService, useValue: { openCustomSnackbar: vi.fn() } },
        ]);
        await router.navigateByUrl('/admin/dashboard');
        await vi.waitFor(() => expect(router.url).toBe('/admin/unauthorized'));
        expect(shellsBuilt).toBe(0);
    });

    describe("with an app's own admin page, which lets editors in", () => {
        const lessons: Route = { path: 'lessons', canActivate: [roleGuard], data: { allowedRoles: ['admin', 'editor'] }, component: PageStub };
        const withLessons = () => table(true).map((route) => route.path === 'admin' ? { ...route, children: [...route.children!, lessons] } : route);
        const signedInAs = (role: string) => [
            { provide: AuthState, useValue: { recordReady: async () => ({ role }) } },
            { provide: ToastService, useValue: { openCustomSnackbar: vi.fn() } },
        ];

        it('keeps the shell moving to and from it', async () => {
            const router = await start(withLessons(), signedInAs('admin'));
            for (const url of ['/admin/dashboard', '/admin/lessons', '/admin/users']) {
                await router.navigateByUrl(url);
                expect(router.url).toBe(url);
            }
            expect(shellsBuilt).toBe(1);
            expect(shellsDestroyed).toBe(0);
        });

        it("opens it for that role, and still refuses that role Arc CMS's own pages", async () => {
            const router = await start(withLessons(), signedInAs('editor'));
            await router.navigateByUrl('/admin/lessons');
            expect(router.url).toBe('/admin/lessons');
            expect(shellsBuilt).toBe(1);

            await router.navigateByUrl('/admin/users');
            await vi.waitFor(() => expect(router.url).toBe('/admin/unauthorized'));
        });
    });

    it('gives every page under the shell the admin guard', () => {
        const unguarded = (adminRoute.children ?? [])
            .filter((route) => !route.redirectTo)
            .filter((route) => !route.canActivate?.includes(roleGuard) || !route.data?.['allowedRoles']?.includes('admin'))
            .map((route) => route.path);
        expect(unguarded).toEqual([]);
    });

    describe('in the route table', () => {
        const source = readFileSync(resolve(__dirname, '../app.routes.ts'), 'utf8');
        const adminDir = resolve(__dirname, 'admin');
        const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
            const path = join(dir, name);
            return statSync(path).isDirectory() ? files(path) : [path];
        });

        it('loads the shell once: a second parent would rebuild it on every move in and out', () => {
            expect(source.match(/import\('\.\/pages\/admin\.page'\)/g)).toHaveLength(1);
        });

        it('lists every admin page file, so a new one joins the shell instead of drawing its own', () => {
            // A file with no default export is not a page: the two "view" files are parts of their list pages.
            const missing = files(adminDir)
                .filter((file) => file.endsWith('.page.ts') && /export default/.test(readFileSync(file, 'utf8')))
                .map((file) => `./pages/admin/${relative(adminDir, file).replace(/\.ts$/, '')}`)
                .filter((page) => !source.includes(`import('${page}')`));
            expect(missing).toEqual([]);
        });
    });
});

describe('the real shell and panel', () => {
    let screen: BehaviorSubject<BreakpointState>;
    let contentTypes: { items: ReturnType<typeof signal>; getAll: ReturnType<typeof vi.fn> };
    let forms: { items: ReturnType<typeof signal<unknown[]>>; subscribe: ReturnType<typeof vi.fn> };

    async function open(url: string) {
        localStorage.clear();
        screen = new BehaviorSubject<BreakpointState>({ matches: false, breakpoints: {} });
        contentTypes = { items: signal([]), getAll: vi.fn() };
        forms = { items: signal<unknown[]>([]), subscribe: vi.fn() };
        TestBed.configureTestingModule({
            imports: [NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([{ ...standIn(adminRoute, false), loadComponent: adminRoute.loadComponent, component: undefined }]),
                { provide: BreakpointObserver, useValue: { observe: () => screen } },
                // recordReady: the shell asks it before moving old product codes (product-codes-upkeep.ts).
                { provide: AuthState, useValue: { currentUser: signal({ name: 'Admin', role: 'admin', photo: '' }), logout: vi.fn(), recordReady: async () => null } },
                { provide: ContentTypesStore, useValue: contentTypes },
                { provide: WaitlistAdminStore, useValue: forms },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                { provide: SiteIdentityService, useValue: { identity: signal({}), loaded: signal(true), load: () => Promise.resolve({}) } },
            ],
        });
        const fixture = TestBed.createComponent(RootStub);
        fixture.autoDetectChanges();
        const router = TestBed.inject(Router);
        await go(fixture, router, url);
        return { fixture, router };
    }

    async function go(fixture: ComponentFixture<RootStub>, router: Router, url: string) {
        await router.navigateByUrl(url);
        await fixture.whenStable();
    }

    const panelScroll = (fixture: ComponentFixture<RootStub>) => fixture.nativeElement.querySelector('.panel-scroll') as HTMLElement;
    const content = (fixture: ComponentFixture<RootStub>) => fixture.nativeElement.querySelector('mat-drawer-content') as HTMLElement;
    const panel = (fixture: ComponentFixture<RootStub>) => fixture.debugElement.query(By.directive(NavbarComponent)).componentInstance as NavbarComponent;
    const group = (fixture: ComponentFixture<RootStub>, id: string) => panel(fixture).menuItems().find((item) => item.id === id)!;

    it('keeps the panel in the page, with its scroll, and reads its menu once', async () => {
        const { fixture, router } = await open('/admin/dashboard');
        const before = panelScroll(fixture);
        before.scrollTop = 120;

        for (const url of ['/admin/settings/about', '/admin/users', '/admin/contents/content-types', '/admin/email/composer']) {
            await go(fixture, router, url);
            expect(panelScroll(fixture), url).toBe(before);
            expect(before.scrollTop, url).toBe(120);
        }
        expect(contentTypes.getAll).toHaveBeenCalledTimes(1);
        expect(forms.subscribe).toHaveBeenCalledTimes(1);
    });

    it('opens a new page at its top, and leaves it where it is when only a filter or sort changes', async () => {
        const { fixture, router } = await open('/admin/users');
        content(fixture).scrollTop = 300;

        await go(fixture, router, '/admin/users?filter_role=admin');
        expect(content(fixture).scrollTop).toBe(300);
        // BaseComponent.onSort and onSearch keep theirs as matrix parameters.
        await go(fixture, router, '/admin/users;sortField=name;sortOrder=asc');
        expect(content(fixture).scrollTop).toBe(300);

        await go(fixture, router, '/admin/media');
        expect(content(fixture).scrollTop).toBe(0);
    });

    it('closes the panel on a phone when a page opens, however it was opened, but not for a filter', async () => {
        const { fixture, router } = await open('/admin/users');
        screen.next({ matches: true, breakpoints: {} });
        await fixture.whenStable();
        const drawer = fixture.debugElement.query(By.directive(MatDrawer)).componentInstance as MatDrawer;
        await drawer.open();

        await go(fixture, router, '/admin/users?filter_role=admin');
        expect(drawer.opened).toBe(true);
        await go(fixture, router, '/admin/users;sortField=name;sortOrder=asc');
        expect(drawer.opened).toBe(true);

        await go(fixture, router, '/admin/media');
        expect(drawer.opened).toBe(false);
    });

    it('leaves a group open when moving on, so nothing above the item pressed moves', async () => {
        const { fixture, router } = await open('/admin/email/composer');
        expect(group(fixture, 'email').isOpen).toBe(true);

        await go(fixture, router, '/admin/users');
        expect(group(fixture, 'email').isOpen).toBe(true);
    });

    it('leaves no group open for a page several of them link to', async () => {
        const { fixture, router } = await open('/admin/waitlists/tags');
        forms.items.set([{ id: 'f1', name: 'First' }, { id: 'f2', name: 'Second' }]);
        await fixture.whenStable();
        const formGroups = () => panel(fixture).menuItems().filter((item) => item.label === 'First' || item.label === 'Second');
        expect(formGroups().map((item) => item.isOpen)).toEqual([true, true]);

        await go(fixture, router, '/admin/users');
        expect(formGroups().map((item) => item.isOpen)).toEqual([false, false]);
    });

    it('keeps a group open for a page in it with a sort in the address', async () => {
        const { fixture, router } = await open('/admin/email-logs;sortField=date;sortOrder=asc');
        expect(group(fixture, 'email').isOpen).toBe(true);

        await go(fixture, router, '/admin/users');
        expect(group(fixture, 'email').isOpen).toBe(true);
    });

    it('keeps a group the person closed closed, until a page in it opens', async () => {
        const { fixture, router } = await open('/admin/email/composer');
        panel(fixture).toggleDropdown(group(fixture, 'email'));
        expect(group(fixture, 'email').isOpen).toBe(false);

        // A filter is the same page, and another page is not in this group.
        await go(fixture, router, '/admin/email/composer?draft=1');
        expect(group(fixture, 'email').isOpen).toBe(false);
        await go(fixture, router, '/admin/users');
        expect(group(fixture, 'email').isOpen).toBe(false);

        await go(fixture, router, '/admin/email-logs');
        expect(group(fixture, 'email').isOpen).toBe(true);
    });

    it('marks the page reached as active in a panel that stays, in the menu and in a group', async () => {
        const { fixture, router } = await open('/admin/dashboard');
        const active = () => [...fixture.nativeElement.querySelectorAll('.sidebar-menu a.active-menu')]
            .map((link) => (link as HTMLAnchorElement).getAttribute('href'));
        expect(active()).toEqual(['/admin/dashboard']);

        await go(fixture, router, '/admin/media');
        expect(active()).toEqual(['/admin/media']);

        await go(fixture, router, '/admin/email/composer');
        expect(active()).toEqual(['/admin/email/composer']);
    });
});
