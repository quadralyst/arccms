import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computed, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router, ActivatedRoute, provideRouter, type Routes } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';

import NavbarComponent, { isWideLogo, svgSize, type MenuItem } from './side-navbar.component';
import { SiteIdentityService } from '../../../app/core/services/site-identity.service';
import { featureOfPath, isCorePath } from '../../../app/core/features/feature-routes';
import type { FeatureId } from '../../../app/core/features/feature-registry';
import { CUSTOM_NAV, CUSTOM_NAV_CHANGES as NAV_FILE_CHANGES } from '../../../custom/nav';
import { CUSTOM_NAV_CHANGES } from '../../../custom/nav-changes';
import { CUSTOM_ROUTES } from '../../../custom/routes';
import { explicitRouteUrls, isServedBy } from '../../../test/route-urls';
import { AuthState } from '../../../app/pages/(auth)/auth.store';
import { ContentTypesStore } from '../../../app/pages/admin/contents/content-types/content-types.store';
import { ContentType } from '../../../app/pages/admin/contents/content-types/content-types.model';
import { WaitlistAdminStore } from '../../../app/pages/admin/(waitlists)/waitlist.store';

/** Settings, About as the panel reads it: loaded, with what a test gives. */
function identityStub(identity: { name?: string; logoUrl?: string } = {}, loaded = true) {
    return { identity: signal(identity), loaded: signal(loaded), load: () => Promise.resolve(identity) };
}

/**
 * Tests for side-navbar slug validation logic
 */
describe('Side Navbar - Slug Validation', () => {
    const mockContentTypes: ContentType[] = [
        {
            id: '1',
            name: 'Blog Post',
            slug: 'blog-post',
            description: 'A blog post content type',
            icon: 'fa-solid fa-blog',
            order: 1,
            fields: [],
            createdAt: { seconds: 0, nanoseconds: 0 },
            createdBy: 'test',
            updatedAt: { seconds: 0, nanoseconds: 0 },
            updatedBy: 'test'
        },
        {
            id: '2',
            name: 'Invalid Type',
            slug: '', // Invalid - missing slug
            description: 'A type without slug',
            icon: 'fa-solid fa-folder',
            order: 2,
            fields: [],
            createdAt: { seconds: 0, nanoseconds: 0 },
            createdBy: 'test',
            updatedAt: { seconds: 0, nanoseconds: 0 },
            updatedBy: 'test'
        },
        {
            id: '3',
            name: 'Product',
            slug: 'product',
            description: 'A product content type',
            icon: 'fa-solid fa-box',
            order: 3,
            fields: [],
            createdAt: { seconds: 0, nanoseconds: 0 },
            createdBy: 'test',
            updatedAt: { seconds: 0, nanoseconds: 0 },
            updatedBy: 'test'
        }
    ];

    it('should filter out content types without slugs', () => {
        const types = mockContentTypes;
        const validTypes = types.filter((t: ContentType) => {
            if (!t.slug) {
                return false;
            }
            return true;
        });

        // Only 2 content types have valid slugs
        expect(validTypes.length).toBe(2);
        expect(validTypes.find(t => t.name === 'Blog Post')).toBeDefined();
        expect(validTypes.find(t => t.name === 'Product')).toBeDefined();
        expect(validTypes.find(t => t.name === 'Invalid Type')).toBeUndefined();
    });

    it('should generate correct routes for content types with valid slugs', () => {
        const validTypes = mockContentTypes.filter(t => !!t.slug);
        const contentTypeLinks = validTypes.map((t: ContentType) => ({
            label: t.name,
            route: `/admin/contents/${t.slug}`,
        }));

        const blogPostItem = contentTypeLinks.find(item => item.label === 'Blog Post');
        expect(blogPostItem).toBeDefined();
        expect(blogPostItem?.route).toBe('/admin/contents/blog-post');

        const productItem = contentTypeLinks.find(item => item.label === 'Product');
        expect(productItem).toBeDefined();
        expect(productItem?.route).toBe('/admin/contents/product');
    });

    it('should log warning for content types without slugs', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn');

        const types = mockContentTypes;
        types.forEach((t: ContentType) => {
            if (!t.slug) {
                console.warn(`Content type "${t.name}" is missing a slug and will not appear in navigation`);
            }
        });

        expect(consoleWarnSpy).toHaveBeenCalledWith(
            'Content type "Invalid Type" is missing a slug and will not appear in navigation'
        );

        consoleWarnSpy.mockRestore();
    });

    it('should not include undefined slugs in routes', () => {
        const validTypes = mockContentTypes.filter(t => !!t.slug);
        const routes = validTypes.map(t => `/admin/contents/${t.slug}`);

        routes.forEach(route => {
            expect(route).not.toContain('undefined');
            expect(route).toMatch(/^\/admin\/contents\/[a-z-]+$/);
        });
    });
});

describe('NavbarComponent', () => {
    let component: NavbarComponent;
    let fixture: any;
    const contentTypesSignal = signal<Partial<ContentType>[]>([]);
    const waitlistsSignal = signal<{ id: string; name: string }[]>([]);

    beforeEach(async () => {
        contentTypesSignal.set([]);
        waitlistsSignal.set([]);
        const authStoreMock = {
            currentUser: signal({ name: 'Test User', role: 'admin', photo: '' }),
            logout: vi.fn(),
        };
        const contentTypesStoreMock = {
            items: contentTypesSignal,
            getAll: vi.fn(),
        };
        const waitlistAdminStoreMock = {
            items: waitlistsSignal,
            subscribe: vi.fn(),
        };
        const dialogMock = {
            open: vi.fn(),
        };
        const routerMock = {
            events: of(),
            navigate: vi.fn(),
            isActive: vi.fn(),
            createUrlTree: vi.fn().mockReturnValue({}),
            serializeUrl: vi.fn().mockReturnValue(''),
            url: '/'
        };

        await TestBed.configureTestingModule({
            imports: [NavbarComponent, NoopAnimationsModule],
            providers: [
                { provide: AuthState, useValue: authStoreMock },
                { provide: ContentTypesStore, useValue: contentTypesStoreMock },
                { provide: WaitlistAdminStore, useValue: waitlistAdminStoreMock },
                { provide: MatDialog, useValue: dialogMock },
                { provide: Router, useValue: routerMock },
                { provide: ActivatedRoute, useValue: {} },
                { provide: SiteIdentityService, useValue: identityStub() },
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(NavbarComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    /**
     * Each menu item whose page has another owner than the item says. A page is a
     * feature's, core's, the app's (src/custom/routes.ts) or nobody's. An app page may
     * be linked by an item of any feature: an app item names one to hide with it.
     */
    const ownershipProblems = (items: MenuItem[]) => {
        const appUrls = explicitRouteUrls(CUSTOM_ROUTES);
        const problems: string[] = [];
        const check = (items: MenuItem[], inherited?: FeatureId) => {
            for (const item of items) {
                const feature = item.feature ?? inherited;
                if (item.subItems) check(item.subItems, feature);
                if (!item.route) continue;
                const path = item.route.split('?')[0].split('/').filter(Boolean);
                const owner = featureOfPath(path) ?? (isCorePath(path) ? undefined : isServedBy(appUrls, path) ? 'app' : 'nobody');
                if (owner === 'app') continue;
                if (owner !== feature) problems.push(`${item.label} (${item.route}): menu says ${feature ?? 'core'}, the page is ${owner ?? 'core'}'s`);
            }
        };
        check(items);
        return problems;
    };

    it("links every item to a page of its own feature, or of core (specs/feature-flags-spec.md 8)", () => {
        contentTypesSignal.set([{ id: '1', name: 'Blog', slug: 'blog' }]);
        waitlistsSignal.set([{ id: 'w1', name: 'Launch' }]);
        expect(ownershipProblems(component.menuItems())).toEqual([]);
    });

    describe("an app's own items (src/custom/nav.ts)", () => {
        // Added to the app's real lists, so an app's own items stay in the check above.
        const nav: MenuItem[] = [
            { label: 'Lessons', route: '/admin/lessons', icon: 'fa-solid fa-book' },
            { label: 'Lesson', route: '/admin/lessons/intro?tab=notes', icon: 'fa-solid fa-book', feature: 'search' },
            { label: 'Broken', route: '/admin/no-such-page', icon: 'fa-solid fa-xmark' },
        ];
        const appRoutes: Routes = [{ path: 'admin', children: [{ path: 'lessons' }, { path: 'lessons/:id' }] }];

        beforeEach(() => {
            CUSTOM_NAV.push(...nav);
            CUSTOM_ROUTES.push(...appRoutes);
            contentTypesSignal.set([{ id: '1', name: 'Blog', slug: 'blog' }]); // recompute the menu
        });
        afterEach(() => {
            CUSTOM_NAV.splice(CUSTOM_NAV.length - nav.length);
            CUSTOM_ROUTES.splice(CUSTOM_ROUTES.length - appRoutes.length);
        });

        it("counts a link to one of the app's routes as the app's page, whatever feature the item names", () => {
            const problems = ownershipProblems(component.menuItems());
            expect(problems.filter((p) => p.startsWith('Lesson'))).toEqual([]);
        });

        it('still reports an app item that links to a page nobody serves', () => {
            expect(ownershipProblems(component.menuItems())).toContain("Broken (/admin/no-such-page): menu says core, the page is nobody's");
        });
    });

    it('should group content types under a single Content menu with Content types first', () => {
        contentTypesSignal.set([
            { id: '1', name: 'Articles', slug: 'articles' },
            { id: '2', name: 'Impact', slug: 'impact' },
        ]);

        const items = component.menuItems();
        const contentGroup = items.find(i => i.label === 'Content');
        expect(contentGroup).toBeDefined();
        expect(contentGroup?.route).toBeUndefined();
        expect(contentGroup?.subItems?.[0]).toMatchObject({
            label: 'Content types',
            route: '/admin/contents/content-types',
        });
        // Authors (D2) sits after Content types, before the per-type links.
        expect(contentGroup?.subItems?.[1]).toMatchObject({ label: 'Authors', route: '/admin/authors' });
        expect(contentGroup?.subItems?.slice(2).map(s => s.label)).toEqual(['Articles', 'Impact']);
        expect(contentGroup?.subItems?.map(s => s.route)).toEqual([
            '/admin/contents/content-types',
            '/admin/authors',
            '/admin/contents/articles',
            '/admin/contents/impact',
        ]);

        // No standalone "Contents Type" item and no "Add ..." entries anywhere
        expect(items.find(i => i.label === 'Contents Type')).toBeUndefined();
        const allSubLabels = items.flatMap(i => i.subItems?.map(s => s.label) ?? []);
        expect(allSubLabels.some(l => l.startsWith('Add '))).toBe(false);
        expect(allSubLabels.some(l => l.startsWith('List '))).toBe(false);
    });

    it('should auto-expand the Content group when a content route is active', () => {
        contentTypesSignal.set([
            { id: '1', name: 'Articles', slug: 'articles' },
            { id: '2', name: 'Impact', slug: 'impact' },
        ]);

        // Not on a content route yet -> group stays collapsed.
        component.currentUrl.set('/admin/dashboard');
        expect(component.menuItems().find(i => i.label === 'Content')?.isOpen).toBe(false);

        // Navigating to a content type's page auto-opens its parent group.
        component.currentUrl.set('/admin/contents/articles');
        expect(component.menuItems().find(i => i.label === 'Content')?.isOpen).toBe(true);
    });

    it('should honour an explicit toggle over route-based auto-expand', () => {
        component.currentUrl.set('/admin/dashboard');
        const audience = component.menuItems().find(i => i.label === 'Audience')!;
        expect(audience.isOpen).toBe(false);

        // User expands a group that has no active child; it must stay open after a recompute.
        component.toggleDropdown(audience);
        expect(component.menuItems().find(i => i.label === 'Audience')?.isOpen).toBe(true);
    });

    it('should have About external link above Logout', () => {
        const items = component.menuItems();
        const aboutIndex = items.findIndex(i => i.label === 'About');
        const logoutIndex = items.findIndex(i => i.label === 'Logout');

        expect(aboutIndex).not.toBe(-1);
        expect(logoutIndex).not.toBe(-1);
        expect(items[aboutIndex].externalUrl).toBe('https://arccms.com/about');
        expect(logoutIndex).toBe(aboutIndex + 1);
    });
});

/**
 * A fresh install reaches the admin from the onboarding wizard, which loads no
 * admin strings, so the nav can render before `en.json` is in. It must pick
 * the labels up when the file arrives, not only after a reload.
 */
describe('NavbarComponent: translations that load after the first render', () => {
    it('replaces the bare keys once the translation file loads', async () => {
        const { TranslocoService, TranslocoTestingModule } = await import('@jsverse/transloco');
        const { firstValueFrom } = await import('rxjs');
        const en = (await import('../../../assets/i18n/en.json')).default;

        await TestBed.configureTestingModule({
            imports: [
                NavbarComponent,
                NoopAnimationsModule,
                TranslocoTestingModule.forRoot({
                    langs: { en },
                    translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
                    preloadLangs: false,
                }),
            ],
            providers: [
                { provide: AuthState, useValue: { currentUser: signal({ name: 'Admin', role: 'admin', photo: '' }), logout: vi.fn() } },
                { provide: ContentTypesStore, useValue: { items: signal([]), getAll: vi.fn() } },
                { provide: WaitlistAdminStore, useValue: { items: signal([]), subscribe: vi.fn() } },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                {
                    provide: Router,
                    useValue: {
                        events: of(), navigate: vi.fn(), isActive: vi.fn(),
                        createUrlTree: vi.fn().mockReturnValue({}), serializeUrl: vi.fn().mockReturnValue(''), url: '/',
                    },
                },
                { provide: ActivatedRoute, useValue: {} },
                { provide: SiteIdentityService, useValue: identityStub() },
            ],
        }).compileComponents();

        const transloco = TestBed.inject(TranslocoService);
        // The nav asks for the file itself; hold it back to see the bare keys first.
        const realLoad = transloco.load.bind(transloco);
        let release: () => void = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        const { from, switchMap } = await import('rxjs');
        const loadSpy = vi.spyOn(transloco, 'load').mockImplementation((lang: string) => from(held).pipe(switchMap(() => realLoad(lang))));

        const fixture = TestBed.createComponent(NavbarComponent);
        fixture.detectChanges();
        const nav = fixture.componentInstance;

        // A memoised computed recomputes only when a signal it read changes,
        // which is exactly what an OnPush template relies on.
        const { computed } = await import('@angular/core');
        const label = computed(() => nav.menuLabel({ label: 'Dashboard', labelKey: 'admin.nav.dashboard' }));
        expect(label()).toBe('admin.nav.dashboard');

        release();
        await firstValueFrom(realLoad('en'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(label()).toBe('Dashboard');
        // Asked by the nav itself, so a page with no translated text of its
        // own (a parent route like /admin/contents) still gets labels.
        expect(loadSpy).toHaveBeenCalledWith('en');
    });
});

describe('NavbarComponent: the site\'s name and logo at the top (specs/admin-brand-spec.md AB-D10)', () => {
    async function render(identity: { name?: string; logoUrl?: string }, expanded: boolean, loaded = true) {
        await TestBed.configureTestingModule({
            imports: [NavbarComponent, NoopAnimationsModule],
            providers: [
                { provide: AuthState, useValue: { currentUser: signal(null), logout: vi.fn() } },
                { provide: ContentTypesStore, useValue: { items: signal([]), getAll: vi.fn() } },
                { provide: WaitlistAdminStore, useValue: { items: signal([]), subscribe: vi.fn() } },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                {
                    provide: Router,
                    useValue: {
                        events: of(), navigate: vi.fn(), isActive: vi.fn(),
                        createUrlTree: vi.fn().mockReturnValue({}), serializeUrl: vi.fn().mockReturnValue(''), url: '/',
                    },
                },
                { provide: ActivatedRoute, useValue: {} },
                { provide: SiteIdentityService, useValue: identityStub(identity, loaded) },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(NavbarComponent);
        fixture.componentInstance.isExpanded = expanded;
        fixture.detectChanges();
        return fixture;
    }

    /** As if the logo had loaded at this size. */
    function loadLogo(fixture: any, width: number, height: number) {
        const img = fixture.nativeElement.querySelector('.logo-container img.logo') as HTMLImageElement;
        Object.defineProperty(img, 'naturalWidth', { value: width });
        Object.defineProperty(img, 'naturalHeight', { value: height });
        img.dispatchEvent(new Event('load'));
        fixture.detectChanges();
    }

    const text = (fixture: any) => (fixture.nativeElement.querySelector('.logo-text')?.textContent ?? '').trim();

    it('calls a logo at least twice as wide as tall a wordmark', () => {
        expect(isWideLogo(300, 60)).toBe(true);
        expect(isWideLogo(120, 60)).toBe(true);
        expect(isWideLogo(100, 60)).toBe(false);
        expect(isWideLogo(64, 64)).toBe(false);
        expect(isWideLogo(10, 0)).toBe(false);
    });

    it('reads an SVG\'s shape from its viewBox, which the browser cannot size on its own', () => {
        expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 60"><text/></svg>')).toEqual({ width: 300, height: 60 });
        expect(svgSize('<?xml version="1.0"?><svg viewBox="0,0,64,64">')).toEqual({ width: 64, height: 64 });
        expect(svgSize('<svg width="120px" height="40">')).toEqual({ width: 120, height: 40 });
        expect(svgSize('<svg>')).toBeNull();
        expect(svgSize('not an svg')).toBeNull();
    });

    it('shows nothing until Settings, About is in, so Arc CMS\'s name never flashes', async () => {
        const fixture = await render({ name: 'Acme Studio' }, true, false);
        expect(fixture.nativeElement.querySelector('.logo-container img')).toBeNull();
        expect(text(fixture)).toBe('');
    });

    it('shows Arc CMS\'s name and logo on a site that has set neither', async () => {
        const fixture = await render({}, true);
        expect(text(fixture)).toBe('Arc CMS');
        expect(fixture.nativeElement.querySelector('.logo-container img.logo-arc')).not.toBeNull();
    });

    it('shows the site\'s name alone when it has no logo', async () => {
        const fixture = await render({ name: 'Acme Studio' }, true);
        expect(text(fixture)).toBe('Acme Studio');
        expect(fixture.nativeElement.querySelector('.logo-container img')).toBeNull();
    });

    it('shows a square logo with the name', async () => {
        const fixture = await render({ name: 'Acme Studio', logoUrl: 'https://x.test/mark.png' }, true);
        loadLogo(fixture, 64, 64);
        expect(text(fixture)).toBe('Acme Studio');
    });

    it('shows a wordmark alone: it already carries the name', async () => {
        const fixture = await render({ name: 'Acme Studio', logoUrl: 'https://x.test/wordmark.png' }, true);
        loadLogo(fixture, 300, 60);
        expect(text(fixture)).toBe('');
        expect(fixture.nativeElement.querySelector('.logo-container img.logo-wide')).not.toBeNull();
    });

    it('shows a square logo in the collapsed panel', async () => {
        const fixture = await render({ name: 'Acme Studio', logoUrl: 'https://x.test/mark.png' }, false);
        loadLogo(fixture, 64, 64);
        expect(fixture.nativeElement.querySelector('.logo-container-close img')).not.toBeNull();
    });

    it('shows no wordmark in the collapsed panel, too narrow to read it', async () => {
        const fixture = await render({ name: 'Acme Studio', logoUrl: 'https://x.test/wordmark.png' }, false);
        loadLogo(fixture, 300, 60);
        expect(fixture.nativeElement.querySelector('.logo-container-close img')).toBeNull();
    });
});

/**
 * The button that opens and closes the panel: in a top row that never scrolls, beside
 * the site's name and logo, which give way to it however long or wide they are.
 */
describe('NavbarComponent: the button at the top of the panel', () => {
    async function render(expanded: boolean, drawerMode = 'side') {
        await TestBed.configureTestingModule({
            imports: [NavbarComponent, NoopAnimationsModule],
            providers: [
                { provide: AuthState, useValue: { currentUser: signal({ name: 'Asha', role: 'admin', photo: '' }), logout: vi.fn() } },
                { provide: ContentTypesStore, useValue: { items: signal([]), getAll: vi.fn() } },
                { provide: WaitlistAdminStore, useValue: { items: signal([]), subscribe: vi.fn() } },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                {
                    provide: Router,
                    useValue: {
                        events: of(), navigate: vi.fn(), isActive: vi.fn(),
                        createUrlTree: vi.fn().mockReturnValue({}), serializeUrl: vi.fn().mockReturnValue(''), url: '/',
                    },
                },
                { provide: ActivatedRoute, useValue: {} },
                { provide: SiteIdentityService, useValue: identityStub({ name: 'A Very Long Site Name That Goes On And On' }) },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(NavbarComponent);
        fixture.componentInstance.isExpanded = expanded;
        fixture.componentInstance.drawerMode = drawerMode;
        fixture.detectChanges();
        return fixture;
    }

    const button = (fixture: any) => fixture.nativeElement.querySelector('button.panel-toggle') as HTMLButtonElement;

    it('sits in the top row, outside the part that scrolls, when the panel is open', async () => {
        const fixture = await render(true);
        expect(button(fixture).closest('.panel-top')).not.toBeNull();
        expect(button(fixture).closest('.panel-scroll')).toBeNull();
        expect(fixture.nativeElement.querySelector('.panel-scroll .sidebar-menu')).not.toBeNull();
        expect(button(fixture).getAttribute('aria-label')).toBe('Collapse menu');
        expect(button(fixture).getAttribute('aria-expanded')).toBe('true');
    });

    it('sits in the top row when the panel is collapsed', async () => {
        const fixture = await render(false);
        expect(button(fixture).closest('.panel-top')).not.toBeNull();
        expect(button(fixture).getAttribute('aria-label')).toBe('Expand menu');
        expect(button(fixture).getAttribute('aria-expanded')).toBe('false');
    });

    it('closes the panel on a phone', async () => {
        const fixture = await render(true, 'over');
        expect(button(fixture).getAttribute('aria-label')).toBe('Close menu');
    });

    it('tells the layout when it is pressed', async () => {
        const fixture = await render(true);
        const toggled = vi.fn();
        fixture.componentInstance.toggleMenu.subscribe(toggled);
        button(fixture).click();
        expect(toggled).toHaveBeenCalledTimes(1);
    });

    it('is never pushed off the panel: the top row keeps its place, the name gives way and only the menu scrolls', () => {
        const scss = fs.readFileSync(path.resolve(__dirname, 'side-navbar.component.scss'), 'utf8');
        const rule = (selector: string) => {
            const start = scss.indexOf(`${selector} {`);
            return start < 0 ? '' : scss.slice(start, scss.indexOf('}', start));
        };
        expect(rule('.panel-top')).toContain('flex-shrink: 0');
        expect(rule('.panel-toggle')).toContain('flex-shrink: 0');
        expect(rule('.logo-container')).toContain('min-width: 0');
        expect(rule('.panel-scroll')).toContain('overflow-y: auto');
        // The old nudges (left: 22% and 30%) pushed it past the panel's edge.
        expect(scss).not.toMatch(/left:\s*\d+%/);
    });
});

/**
 * The app's changes to the admin menu (CUSTOM_NAV_CHANGES in src/custom/nav-changes.ts), read
 * back from the rendered menu with a real router, so each link's address is the one a
 * person follows.
 */
describe("NavbarComponent: the app's menu changes (src/custom/nav-changes.ts)", () => {
    let component: NavbarComponent;
    let fixture: ComponentFixture<NavbarComponent>;
    const role = signal('admin');
    const contentTypes = signal<Partial<ContentType>[]>([]);

    beforeEach(async () => {
        role.set('admin');
        await TestBed.configureTestingModule({
            imports: [NavbarComponent, NoopAnimationsModule],
            providers: [
                provideRouter([]),
                { provide: AuthState, useValue: { currentUser: computed(() => ({ name: 'Test User', role: role(), photo: '' })), logout: vi.fn() } },
                { provide: ContentTypesStore, useValue: { items: contentTypes, getAll: vi.fn() } },
                { provide: WaitlistAdminStore, useValue: { items: signal([]), subscribe: vi.fn() } },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                { provide: SiteIdentityService, useValue: identityStub() },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(NavbarComponent);
        component = fixture.componentInstance;
        component.isExpanded = true;
    });

    afterEach(() => {
        delete CUSTOM_NAV_CHANGES.admin;
        delete NAV_FILE_CHANGES.admin;
    });

    /** Each top-level row: its label, address and icon, or --- for a separator. */
    const renderedMenu = () => {
        fixture.detectChanges();
        const rows = fixture.nativeElement.querySelectorAll('.sidebar-menu > a, .sidebar-menu > hr') as NodeListOf<HTMLElement>;
        return [...rows].map((row) => {
            if (row.tagName === 'HR') return '---';
            const icon = [...row.querySelector('i')!.classList].filter((c) => c.startsWith('fa-')).join(' ');
            return `${row.textContent!.trim()} ${row.getAttribute('href') ?? '-'} ${icon}`;
        });
    };

    it('shows the menu as Arc CMS ships it when the app changes nothing', () => {
        expect(renderedMenu()).toEqual([
            'Dashboard /admin/dashboard fa-solid fa-gauge-high',
            'Signup Forms /admin/waitlists fa-solid fa-list-alt',
            'Media Manager /admin/media fa-solid fa-images',
            '---',
            'Content - fa-solid fa-layer-group',
            '---',
            'Users /admin/users fa-solid fa-users',
            'Audience - fa-solid fa-address-book',
            'Email + SMS - fa-solid fa-palette',
            'Feedback /admin/feedback fa-solid fa-comment-dots',
            'Messages /admin/messages fa-solid fa-envelope',
            'Products /admin/products fa-solid fa-box-open',
            'Transactions /admin/transactions fa-solid fa-receipt',
            'Data - fa-solid fa-database',
            '---',
            'Profile /admin/profile fa-solid fa-user',
            'Settings /admin/settings fa-solid fa-gear',
            'About https://arccms.com/about fa-solid fa-circle-info',
            'Logout - fa-solid fa-right-from-bracket',
        ]);
    });

    it("opens the app's own page from Dashboard when the app changes its route", () => {
        CUSTOM_NAV_CHANGES.admin = [{ id: 'dashboard', route: '/admin/extension-dashboard' }];
        expect(renderedMenu()[0]).toBe('Dashboard /admin/extension-dashboard fa-solid fa-gauge-high');
    });

    // An app that wrote its changes in src/custom/nav.ts, where they first lived, keeps them.
    it('reads changes from src/custom/nav.ts too, before those in nav-changes.ts', () => {
        NAV_FILE_CHANGES.admin = [{ id: 'media', hide: true }, { id: 'dashboard', label: 'Home' }];
        CUSTOM_NAV_CHANGES.admin = [{ id: 'dashboard', route: '/admin/extension-dashboard' }];
        expect(renderedMenu().slice(0, 3)).toEqual([
            'Home /admin/extension-dashboard fa-solid fa-gauge-high',
            'Signup Forms /admin/waitlists fa-solid fa-list-alt',
            '---',
        ]);
    });

    it('hides, adds and moves items for the roles a change names, and keeps Profile and Logout', () => {
        CUSTOM_NAV_CHANGES.admin = [
            { id: 'media', hide: true },
            { id: 'content', hide: true },
            { add: { id: 'reports', label: 'Reports', route: '/admin/reports', icon: 'fa-solid fa-chart-line', allowRoles: ['admin', 'editor'] }, after: 'dashboard' },
            { id: 'settings', before: 'dashboard', roles: ['admin'] },
            { id: 'profile', hide: true },
            { id: 'logout', hide: true },
        ];
        const rows = renderedMenu();
        expect(rows.slice(0, 5)).toEqual([
            'Settings /admin/settings fa-solid fa-gear',
            'Dashboard /admin/dashboard fa-solid fa-gauge-high',
            'Reports /admin/reports fa-solid fa-chart-line',
            'Signup Forms /admin/waitlists fa-solid fa-list-alt',
            '---',
        ]);
        expect(rows.filter((r) => r === '---')).toHaveLength(2);
        expect(rows.slice(-4)).toEqual(['---', 'Profile /admin/profile fa-solid fa-user', 'About https://arccms.com/about fa-solid fa-circle-info', 'Logout - fa-solid fa-right-from-bracket']);
    });

    it("shows an editor the items the app's changes give that role, with Profile and Logout", () => {
        CUSTOM_NAV_CHANGES.admin = [
            { add: { id: 'reports', label: 'Reports', route: '/admin/reports', icon: 'fa-solid fa-chart-line', allowRoles: ['admin', 'editor'] }, after: 'dashboard' },
            { id: 'media', allowRoles: ['admin', 'editor'], roles: ['editor'] },
            { id: 'profile', allowRoles: ['editor'] },
            { id: 'logout', allowRoles: ['editor'] },
        ];
        role.set('editor');
        expect(renderedMenu()).toEqual([
            'Reports /admin/reports fa-solid fa-chart-line',
            'Media Manager /admin/media fa-solid fa-images',
            // Separators are for admins and users, as before.
            'Profile /admin/profile fa-solid fa-user',
            'Logout - fa-solid fa-right-from-bracket',
        ]);
    });

    it('opens the sign-out dialog from Logout, found by its id whatever its label', () => {
        CUSTOM_NAV_CHANGES.admin = [{ id: 'logout', label: 'Sign out' }];
        expect(renderedMenu().at(-1)).toBe('Sign out - fa-solid fa-right-from-bracket');
        const confirm = vi.spyOn(component, 'confirmLogout').mockImplementation(() => {});
        ([...fixture.nativeElement.querySelectorAll('.sidebar-menu > a')].at(-1) as HTMLElement).click();
        expect(confirm).toHaveBeenCalled();
    });
});
