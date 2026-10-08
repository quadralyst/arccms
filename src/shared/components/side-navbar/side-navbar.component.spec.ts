import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router, ActivatedRoute, type Routes } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import NavbarComponent, { isWideLogo, type MenuItem } from './side-navbar.component';
import { SiteIdentityService } from '../../../app/core/services/site-identity.service';
import { featureOfPath, isCorePath } from '../../../app/core/features/feature-routes';
import type { FeatureId } from '../../../app/core/features/feature-registry';
import { CUSTOM_NAV } from '../../../custom/nav';
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

        const fixture = TestBed.createComponent(NavbarComponent);
        fixture.detectChanges();
        const nav = fixture.componentInstance;

        // A memoised computed recomputes only when a signal it read changes,
        // which is exactly what an OnPush template relies on.
        const { computed } = await import('@angular/core');
        const label = computed(() => nav.menuLabel({ label: 'Dashboard', labelKey: 'admin.nav.dashboard' }));
        expect(label()).toBe('admin.nav.dashboard');

        await firstValueFrom(TestBed.inject(TranslocoService).load('en'));

        expect(label()).toBe('Dashboard');
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

    it('shows nothing until Settings, About is in, so Arc CMS\'s name never flashes', async () => {
        const fixture = await render({ name: 'Tapout POS' }, true, false);
        expect(fixture.nativeElement.querySelector('.logo-container img')).toBeNull();
        expect(text(fixture)).toBe('');
    });

    it('shows Arc CMS\'s name and logo on a site that has set neither', async () => {
        const fixture = await render({}, true);
        expect(text(fixture)).toBe('Arc CMS');
        expect(fixture.nativeElement.querySelector('.logo-container img.logo-arc')).not.toBeNull();
    });

    it('shows the site\'s name alone when it has no logo', async () => {
        const fixture = await render({ name: 'Tapout POS' }, true);
        expect(text(fixture)).toBe('Tapout POS');
        expect(fixture.nativeElement.querySelector('.logo-container img')).toBeNull();
    });

    it('shows a square logo with the name', async () => {
        const fixture = await render({ name: 'Tapout POS', logoUrl: 'https://x.test/mark.png' }, true);
        loadLogo(fixture, 64, 64);
        expect(text(fixture)).toBe('Tapout POS');
    });

    it('shows a wordmark alone: it already carries the name', async () => {
        const fixture = await render({ name: 'Tapout POS', logoUrl: 'https://x.test/wordmark.png' }, true);
        loadLogo(fixture, 300, 60);
        expect(text(fixture)).toBe('');
        expect(fixture.nativeElement.querySelector('.logo-container img.logo-wide')).not.toBeNull();
    });

    it('shows a square logo in the collapsed panel', async () => {
        const fixture = await render({ name: 'Tapout POS', logoUrl: 'https://x.test/mark.png' }, false);
        loadLogo(fixture, 64, 64);
        expect(fixture.nativeElement.querySelector('.logo-container-close img')).not.toBeNull();
    });

    it('shows no wordmark in the collapsed panel, too narrow to read it', async () => {
        const fixture = await render({ name: 'Tapout POS', logoUrl: 'https://x.test/wordmark.png' }, false);
        loadLogo(fixture, 300, 60);
        expect(fixture.nativeElement.querySelector('.logo-container-close img')).toBeNull();
    });
});
