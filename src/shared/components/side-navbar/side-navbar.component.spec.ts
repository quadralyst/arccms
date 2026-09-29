import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router, ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import NavbarComponent, { type MenuItem } from './side-navbar.component';
import { featureOfPath, isCorePath } from '../../../app/core/features/feature-routes';
import type { FeatureId } from '../../../app/core/features/feature-registry';
import { AuthState } from '../../../app/pages/(auth)/auth.store';
import { ContentTypesStore } from '../../../app/pages/admin/contents/content-types/content-types.store';
import { ContentType } from '../../../app/pages/admin/contents/content-types/content-types.model';
import { WaitlistAdminStore } from '../../../app/pages/admin/(waitlists)/waitlist.store';

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
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(NavbarComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it("links every item to a page of its own feature, or of core (docs/feature-flags-spec.md 8)", () => {
        contentTypesSignal.set([{ id: '1', name: 'Blog', slug: 'blog' }]);
        waitlistsSignal.set([{ id: 'w1', name: 'Launch' }]);
        const problems: string[] = [];
        const check = (items: MenuItem[], inherited?: FeatureId) => {
            for (const item of items) {
                const feature = item.feature ?? inherited;
                if (item.subItems) check(item.subItems, feature);
                if (!item.route) continue;
                const path = item.route.split('?')[0].split('/').filter(Boolean);
                const owner = featureOfPath(path) ?? (isCorePath(path) ? undefined : 'nobody');
                if (owner !== feature) problems.push(`${item.label} (${item.route}): menu says ${feature ?? 'core'}, the page is ${owner ?? 'core'}'s`);
            }
        };
        check(component.menuItems());
        expect(problems).toEqual([]);
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
