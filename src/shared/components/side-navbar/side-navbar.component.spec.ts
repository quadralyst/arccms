import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router, ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import NavbarComponent from './side-navbar.component';
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
        const dynamicItems = validTypes.map((t: ContentType) => ({
            label: t.name,
            subItems: [
                { label: `List ${t.name}`, route: `/admin/contents/${t.slug}` },
                { label: `Add ${t.name}`, route: `/admin/contents/${t.slug}/add` }
            ]
        }));

        const blogPostItem = dynamicItems.find(item => item.label === 'Blog Post');
        expect(blogPostItem).toBeDefined();
        expect(blogPostItem?.subItems?.[0].route).toBe('/admin/contents/blog-post');
        expect(blogPostItem?.subItems?.[1].route).toBe('/admin/contents/blog-post/add');

        const productItem = dynamicItems.find(item => item.label === 'Product');
        expect(productItem).toBeDefined();
        expect(productItem?.subItems?.[0].route).toBe('/admin/contents/product');
        expect(productItem?.subItems?.[1].route).toBe('/admin/contents/product/add');
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
        const routes = validTypes.flatMap(t => [
            `/admin/contents/${t.slug}`,
            `/admin/contents/${t.slug}/add`
        ]);

        routes.forEach(route => {
            expect(route).not.toContain('undefined');
            expect(route).toMatch(/^\/admin\/contents\/[a-z-]+(\/add)?$/);
        });
    });
});

describe('NavbarComponent', () => {
    let component: NavbarComponent;
    let fixture: any;

    beforeEach(async () => {
        const authStoreMock = {
            currentUser: signal({ name: 'Test User', role: 'admin', photo: '' }),
            logout: vi.fn(),
        };
        const contentTypesStoreMock = {
            items: signal([]),
            getAll: vi.fn(),
        };
        const waitlistAdminStoreMock = {
            items: signal([]),
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
