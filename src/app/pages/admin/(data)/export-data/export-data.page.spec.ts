import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import ExportDataPageComponent from './export-data.page';
import { ExportDataService } from './export-data.service';
import { CollectionGroup, ContentTypeBundle } from '../data-constants';

describe('ExportDataPageComponent', () => {
    let component: ExportDataPageComponent;
    let fixture: ComponentFixture<ExportDataPageComponent>;
    let mockExportService: any;

    const mockBundles: ContentTypeBundle[] = [
        {
            contentTypeSlug: 'blog',
            contentTypeName: 'Blog',
            contentTypeIcon: 'fa-solid fa-pen',
            draftsCollection: { name: 'arc_blog_drafts', displayName: 'Blog (Drafts)', isDynamic: true },
            publishedCollection: { name: 'arc_blog', displayName: 'Blog (Published)', isDynamic: true },
            tagsCollection: { name: 'Tags_blog', displayName: 'Tags (Blog)', isDynamic: true },
            referencedSlugs: [],
        },
    ];

    const mockGroups: CollectionGroup[] = [
        {
            id: 'content',
            label: 'Content',
            icon: 'fa-solid fa-file-lines',
            collections: [{ name: 'ContentTypes', displayName: 'Content Types' }],
            contentTypeBundles: mockBundles,
        },
        {
            id: 'users-waitlists',
            label: 'Users & Waitlists',
            icon: 'fa-solid fa-users',
            collections: [
                { name: 'users', displayName: 'Users' },
                { name: 'Waitlists', displayName: 'Waitlists' },
            ],
        },
        {
            id: 'settings-media',
            label: 'Settings & Media',
            icon: 'fa-solid fa-gear',
            collections: [
                { name: 'Settings', displayName: 'Settings' },
                { name: 'media', displayName: 'Media Metadata' },
            ],
        },
        {
            id: 'email',
            label: 'Email',
            icon: 'fa-solid fa-envelope',
            collections: [{ name: 'EmailTemplate', displayName: 'Email Templates' }],
        },
    ];

    beforeEach(async () => {
        mockExportService = {
            getCollectionGroups: vi.fn().mockReturnValue(mockGroups),
            getAvailableCollections: vi.fn().mockReturnValue([]),
            getCollectionCount: vi.fn().mockResolvedValue(10),
            expandBundleSelections: vi.fn().mockImplementation(
                (cols: any[], bundles: any[]) => {
                    const flat = [...cols];
                    for (const b of bundles) {
                        flat.push(b.draftsCollection, b.publishedCollection, b.tagsCollection);
                    }
                    return flat;
                },
            ),
            exportCollections: vi.fn().mockResolvedValue({
                version: '1.0',
                exportedAt: '2024-01-01',
                collections: { ContentTypes: { doc1: {} } },
                metadata: { totalDocuments: 1, collectionSummary: [{ name: 'ContentTypes', count: 1 }] },
            }),
            downloadAsJson: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [
                ExportDataPageComponent,
                NoopAnimationsModule,
            ],
            providers: [
                provideRouter([]),
                { provide: Firestore, useValue: {} },
                { provide: ExportDataService, useValue: mockExportService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ExportDataPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should load groups on init', () => {
        expect(mockExportService.getCollectionGroups).toHaveBeenCalled();
        expect(component.groups().length).toBe(4);
    });

    it('should create groups with correct structure', () => {
        const groups = component.groups();
        expect(groups[0].id).toBe('content');
        expect(groups[0].label).toBe('Content');
        expect(groups[0].collections.length).toBe(1); // ContentTypes
        expect(groups[0].bundles.length).toBe(1);      // Blog bundle
    });

    it('should start with all groups expanded', () => {
        expect(component.groups().every((g) => g.expanded)).toBe(true);
    });

    it('should start with nothing selected', () => {
        expect(component.totalSelectedCount).toBe(0);
    });

    // Group toggling
    describe('toggleGroup', () => {
        it('should select all collections and bundles in a group', () => {
            component.toggleGroup('content', true);
            const contentGroup = component.groups().find((g) => g.id === 'content')!;
            expect(contentGroup.collections.every((c) => c.selected)).toBe(true);
            expect(contentGroup.bundles.every((b) => b.selected)).toBe(true);
        });

        it('should deselect all collections and bundles in a group', () => {
            component.toggleGroup('content', true);
            component.toggleGroup('content', false);
            const contentGroup = component.groups().find((g) => g.id === 'content')!;
            expect(contentGroup.collections.every((c) => !c.selected)).toBe(true);
            expect(contentGroup.bundles.every((b) => !b.selected)).toBe(true);
        });

        it('should not affect other groups', () => {
            component.toggleGroup('content', true);
            const usersGroup = component.groups().find((g) => g.id === 'users-waitlists')!;
            expect(usersGroup.collections.every((c) => !c.selected)).toBe(true);
        });
    });

    describe('toggleGroupExpanded', () => {
        it('should collapse expanded group', () => {
            component.toggleGroupExpanded('content');
            expect(component.groups().find((g) => g.id === 'content')!.expanded).toBe(false);
        });

        it('should expand collapsed group', () => {
            component.toggleGroupExpanded('content');
            component.toggleGroupExpanded('content');
            expect(component.groups().find((g) => g.id === 'content')!.expanded).toBe(true);
        });
    });

    // Bundle toggling
    describe('toggleBundle', () => {
        it('should select a content type bundle', () => {
            component.toggleBundle('content', 'blog');
            const bundle = component.groups()
                .find((g) => g.id === 'content')!
                .bundles.find((b) => b.bundle.contentTypeSlug === 'blog')!;
            expect(bundle.selected).toBe(true);
        });

        it('should count bundle as 3 collections in totalSelectedCount', () => {
            component.toggleBundle('content', 'blog');
            expect(component.totalSelectedCount).toBe(3);
        });

        it('should toggle bundle off', () => {
            component.toggleBundle('content', 'blog');
            component.toggleBundle('content', 'blog');
            const bundle = component.groups()
                .find((g) => g.id === 'content')!
                .bundles.find((b) => b.bundle.contentTypeSlug === 'blog')!;
            expect(bundle.selected).toBe(false);
        });
    });

    describe('toggleBundleExpanded', () => {
        it('should expand bundle details', () => {
            component.toggleBundleExpanded('content', 'blog');
            const bundle = component.groups()
                .find((g) => g.id === 'content')!
                .bundles.find((b) => b.bundle.contentTypeSlug === 'blog')!;
            expect(bundle.expanded).toBe(true);
        });
    });

    // Collection toggling
    describe('toggleCollection', () => {
        it('should toggle individual static collection', () => {
            component.toggleCollection('content', 'ContentTypes');
            const col = component.groups()
                .find((g) => g.id === 'content')!
                .collections.find((c) => c.name === 'ContentTypes')!;
            expect(col.selected).toBe(true);
            expect(component.totalSelectedCount).toBe(1);
        });
    });

    // Group selection helpers
    describe('isGroupFullySelected', () => {
        it('should return true when all items selected', () => {
            component.toggleGroup('users-waitlists', true);
            const group = component.groups().find((g) => g.id === 'users-waitlists')!;
            expect(component.isGroupFullySelected(group)).toBe(true);
        });

        it('should return false when not all items selected', () => {
            component.toggleCollection('users-waitlists', 'users');
            const group = component.groups().find((g) => g.id === 'users-waitlists')!;
            expect(component.isGroupFullySelected(group)).toBe(false);
        });
    });

    describe('isGroupPartiallySelected', () => {
        it('should return true when some but not all items selected', () => {
            component.toggleCollection('users-waitlists', 'users');
            const group = component.groups().find((g) => g.id === 'users-waitlists')!;
            expect(component.isGroupPartiallySelected(group)).toBe(true);
        });

        it('should return false when no items selected', () => {
            const group = component.groups().find((g) => g.id === 'users-waitlists')!;
            expect(component.isGroupPartiallySelected(group)).toBe(false);
        });

        it('should return false when all items selected', () => {
            component.toggleGroup('users-waitlists', true);
            const group = component.groups().find((g) => g.id === 'users-waitlists')!;
            expect(component.isGroupPartiallySelected(group)).toBe(false);
        });
    });

    // Presets
    describe('applyPreset', () => {
        it('should select everything with "all" preset', () => {
            component.applyPreset('all');
            expect(component.allSelected).toBe(true);
            // All static collections (1+2+2+1=6) + 1 bundle * 3 = 9
            expect(component.totalSelectedCount).toBe(9);
        });

        it('should select only content group with "all-content" preset', () => {
            component.applyPreset('all-content');
            const contentGroup = component.groups().find((g) => g.id === 'content')!;
            expect(contentGroup.collections.every((c) => c.selected)).toBe(true);
            expect(contentGroup.bundles.every((b) => b.selected)).toBe(true);

            const usersGroup = component.groups().find((g) => g.id === 'users-waitlists')!;
            expect(usersGroup.collections.every((c) => !c.selected)).toBe(true);
        });

        it('should select only settings-media group with "all-settings" preset', () => {
            component.applyPreset('all-settings');
            const settingsGroup = component.groups().find((g) => g.id === 'settings-media')!;
            expect(settingsGroup.collections.every((c) => c.selected)).toBe(true);

            const contentGroup = component.groups().find((g) => g.id === 'content')!;
            expect(contentGroup.collections.every((c) => !c.selected)).toBe(true);
            expect(contentGroup.bundles.every((b) => !b.selected)).toBe(true);
        });
    });

    // Export
    describe('startExport', () => {
        it('should expand bundles before calling exportCollections', async () => {
            component.toggleGroup('content', true);
            await component.startExport();

            expect(mockExportService.expandBundleSelections).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'ContentTypes' }),
                ]),
                expect.arrayContaining([
                    expect.objectContaining({ contentTypeSlug: 'blog' }),
                ]),
            );
        });

        it('should call exportCollections with flat list', async () => {
            component.toggleBundle('content', 'blog');
            await component.startExport();

            expect(mockExportService.exportCollections).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'arc_blog_drafts' }),
                    expect.objectContaining({ name: 'arc_blog' }),
                    expect.objectContaining({ name: 'Tags_blog' }),
                ]),
                expect.any(Function),
            );
        });

        it('should set exportComplete after successful export', async () => {
            component.toggleCollection('content', 'ContentTypes');
            await component.startExport();

            expect(component.exportComplete()).toBe(true);
            expect(component.isExporting()).toBe(false);
        });

        it('should handle export errors', async () => {
            mockExportService.exportCollections.mockRejectedValueOnce(new Error('Firestore error'));

            component.toggleCollection('content', 'ContentTypes');
            await component.startExport();

            expect(component.exportError()).toBe('Firestore error');
            expect(component.isExporting()).toBe(false);
        });

        it('should not export when nothing is selected', async () => {
            await component.startExport();
            expect(mockExportService.exportCollections).not.toHaveBeenCalled();
        });
    });

    // Auto-select referenced bundles
    describe('auto-select dependencies', () => {
        const refBundles: ContentTypeBundle[] = [
            {
                contentTypeSlug: 'journals',
                contentTypeName: 'Journals',
                draftsCollection: { name: 'arc_journals_drafts', displayName: 'Journals (Drafts)', isDynamic: true },
                publishedCollection: { name: 'arc_journals', displayName: 'Journals (Published)', isDynamic: true },
                tagsCollection: { name: 'Tags_journals', displayName: 'Tags (Journals)', isDynamic: true },
                referencedSlugs: ['people'],
            },
            {
                contentTypeSlug: 'people',
                contentTypeName: 'People',
                draftsCollection: { name: 'arc_people_drafts', displayName: 'People (Drafts)', isDynamic: true },
                publishedCollection: { name: 'arc_people', displayName: 'People (Published)', isDynamic: true },
                tagsCollection: { name: 'Tags_people', displayName: 'Tags (People)', isDynamic: true },
                referencedSlugs: [],
            },
        ];

        const refGroups: CollectionGroup[] = [
            {
                id: 'content',
                label: 'Content',
                icon: 'fa-solid fa-file-lines',
                collections: [{ name: 'ContentTypes', displayName: 'Content Types' }],
                contentTypeBundles: refBundles,
            },
            {
                id: 'users-waitlists',
                label: 'Users & Waitlists',
                icon: 'fa-solid fa-users',
                collections: [{ name: 'users', displayName: 'Users' }],
            },
        ];

        beforeEach(() => {
            mockExportService.getCollectionGroups.mockReturnValue(refGroups);
            fixture = TestBed.createComponent(ExportDataPageComponent);
            component = fixture.componentInstance;
            fixture.detectChanges();
        });

        it('should auto-select referenced bundles when selecting a bundle', () => {
            component.toggleBundle('content', 'journals');

            const groups = component.groups();
            const contentGroup = groups.find((g) => g.id === 'content')!;
            const journalsBundle = contentGroup.bundles.find((b) => b.bundle.contentTypeSlug === 'journals')!;
            const peopleBundle = contentGroup.bundles.find((b) => b.bundle.contentTypeSlug === 'people')!;

            expect(journalsBundle.selected).toBe(true);
            expect(peopleBundle.selected).toBe(true);
        });

        it('should not auto-deselect referenced bundles when deselecting', () => {
            // Select journals (auto-selects people)
            component.toggleBundle('content', 'journals');
            // Deselect journals
            component.toggleBundle('content', 'journals');

            const groups = component.groups();
            const contentGroup = groups.find((g) => g.id === 'content')!;
            const journalsBundle = contentGroup.bundles.find((b) => b.bundle.contentTypeSlug === 'journals')!;
            const peopleBundle = contentGroup.bundles.find((b) => b.bundle.contentTypeSlug === 'people')!;

            expect(journalsBundle.selected).toBe(false);
            expect(peopleBundle.selected).toBe(true); // stays selected
        });

        it('should count auto-selected bundles in totalSelectedCount', () => {
            component.toggleBundle('content', 'journals');
            // journals (3) + people auto-selected (3) = 6
            expect(component.totalSelectedCount).toBe(6);
        });

        it('should not re-select already selected referenced bundles', () => {
            // First select people manually
            component.toggleBundle('content', 'people');
            // Then select journals (which references people)
            component.toggleBundle('content', 'journals');

            const groups = component.groups();
            const contentGroup = groups.find((g) => g.id === 'content')!;
            expect(contentGroup.bundles.every((b) => b.selected)).toBe(true);
        });

        it('should return referenced names for display', () => {
            const names = component.getReferencedNames(['people']);
            expect(names).toBe('People');
        });
    });
});
