import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { ExportDataService } from './export-data.service';
import { ContentTypesStore } from '../../contents/content-types/content-types.store';
import { CollectionConfig, ContentTypeBundle, ExportProgress } from '../data-constants';

// Mock @angular/fire/firestore
vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual('@angular/fire/firestore');
    return {
        ...actual,
        collection: vi.fn((db: any, ...pathSegments: string[]) => ({
            path: pathSegments.join('/'),
            firestore: db,
        })),
        getDocs: vi.fn().mockResolvedValue({
            docs: [
                {
                    id: 'doc1',
                    data: () => ({ title: 'Test Doc 1', count: 10 }),
                },
                {
                    id: 'doc2',
                    data: () => ({ title: 'Test Doc 2', count: 20 }),
                },
            ],
            size: 2,
        }),
        getCountFromServer: vi.fn().mockResolvedValue({
            data: () => ({ count: 5 }),
        }),
        query: vi.fn((...args: any[]) => args[0]),
        limit: vi.fn((n: number) => ({ type: 'limit', value: n })),
        startAfter: vi.fn((doc: any) => ({ type: 'startAfter', value: doc })),
    };
});

describe('ExportDataService', () => {
    let service: ExportDataService;
    let mockContentTypesStore: any;

    beforeEach(async () => {
        mockContentTypesStore = {
            items: signal([
                { id: 'ct1', slug: 'blog', name: 'Blog', fields: [] },
                { id: 'ct2', slug: 'news', name: 'News', fields: [] },
            ]),
            getAll: vi.fn(),
        };

        await TestBed.configureTestingModule({
            providers: [
                ExportDataService,
                { provide: Firestore, useValue: {} },
                { provide: ContentTypesStore, useValue: mockContentTypesStore },
            ],
        }).compileComponents();

        service = TestBed.inject(ExportDataService);
    });

    describe('getAvailableCollections', () => {
        it('should return known collections', () => {
            const collections = service.getAvailableCollections();
            const names = collections.map((c) => c.name);

            expect(names).toContain('ContentTypes');
            expect(names).not.toContain('DraftContents');
            expect(names).not.toContain('Contents');
            expect(names).toContain('users');
            expect(names).toContain('Settings');
            expect(names).toContain('Waitlists');
        });

        it('should include dynamic Tags_ collections from ContentTypesStore', () => {
            const collections = service.getAvailableCollections();
            const names = collections.map((c) => c.name);

            expect(names).toContain('Tags_blog');
            expect(names).toContain('Tags_news');
        });

        it('should mark dynamic collections with isDynamic flag', () => {
            const collections = service.getAvailableCollections();
            const tagsBlog = collections.find((c) => c.name === 'Tags_blog');

            expect(tagsBlog?.isDynamic).toBe(true);
            expect(tagsBlog?.displayName).toBe('Tags (Blog)');
        });

        it('should skip content types without slugs', () => {
            mockContentTypesStore.items.set([
                { id: 'ct1', slug: '', name: 'NoSlug', fields: [] },
                { id: 'ct2', slug: 'valid', name: 'Valid', fields: [] },
            ]);

            const collections = service.getAvailableCollections();
            const names = collections.map((c) => c.name);

            expect(names).not.toContain('Tags_');
            expect(names).toContain('Tags_valid');
        });

        it('should include arc_*_drafts collections for content types', () => {
            const collections = service.getAvailableCollections();
            const names = collections.map((c) => c.name);

            expect(names).toContain('arc_blog_drafts');
            expect(names).toContain('arc_news_drafts');
        });

        it('should include arc_* published collections for content types', () => {
            const collections = service.getAvailableCollections();
            const names = collections.map((c) => c.name);

            expect(names).toContain('arc_blog');
            expect(names).toContain('arc_news');
        });
    });

    describe('getCollectionGroups', () => {
        it('should return 4 groups in correct order (no legacy)', () => {
            const groups = service.getCollectionGroups();
            expect(groups).toHaveLength(4);
            expect(groups[0].id).toBe('content');
            expect(groups[1].id).toBe('users-waitlists');
            expect(groups[2].id).toBe('settings-media');
            expect(groups[3].id).toBe('email');
        });

        it('should put ContentTypes in content group', () => {
            const groups = service.getCollectionGroups();
            const contentGroup = groups.find((g) => g.id === 'content')!;
            expect(contentGroup.collections.some((c) => c.name === 'ContentTypes')).toBe(true);
        });

        it('should create bundles with correct 3 sub-collections', () => {
            const groups = service.getCollectionGroups();
            const contentGroup = groups.find((g) => g.id === 'content')!;
            const bundles = contentGroup.contentTypeBundles!;

            expect(bundles.length).toBe(2); // blog and news

            const blogBundle = bundles.find((b) => b.contentTypeSlug === 'blog')!;
            expect(blogBundle.draftsCollection.name).toBe('arc_blog_drafts');
            expect(blogBundle.publishedCollection.name).toBe('arc_blog');
            expect(blogBundle.tagsCollection.name).toBe('Tags_blog');
        });

        it('should populate referencedSlugs from collectionRef fields', () => {
            mockContentTypesStore.items.set([
                {
                    id: 'ct1', slug: 'journals', name: 'Journals',
                    fields: [
                        { key: 'author', label: 'Author', type: 'text', useCollectionRef: true, collectionRef: { collectionSlug: 'people' } },
                        { key: 'category', label: 'Category', type: 'text', useCollectionRef: false },
                    ],
                },
                { id: 'ct2', slug: 'people', name: 'People', fields: [] },
            ]);

            const groups = service.getCollectionGroups();
            const contentGroup = groups.find((g) => g.id === 'content')!;
            const journalsBundle = contentGroup.contentTypeBundles!.find((b) => b.contentTypeSlug === 'journals')!;
            const peopleBundle = contentGroup.contentTypeBundles!.find((b) => b.contentTypeSlug === 'people')!;

            expect(journalsBundle.referencedSlugs).toEqual(['people']);
            expect(peopleBundle.referencedSlugs).toEqual([]);
        });

        it('should have empty referencedSlugs when no collectionRef fields', () => {
            const groups = service.getCollectionGroups();
            const contentGroup = groups.find((g) => g.id === 'content')!;
            const blogBundle = contentGroup.contentTypeBundles!.find((b) => b.contentTypeSlug === 'blog')!;

            expect(blogBundle.referencedSlugs).toEqual([]);
        });

        it('should not have a legacy group', () => {
            const groups = service.getCollectionGroups();
            expect(groups.find((g) => g.id === 'legacy' as any)).toBeUndefined();
        });

        it('should put users in users-waitlists group', () => {
            const groups = service.getCollectionGroups();
            const usersGroup = groups.find((g) => g.id === 'users-waitlists')!;
            expect(usersGroup.collections.some((c) => c.name === 'users')).toBe(true);
        });

        it('should not have bundles in non-content groups', () => {
            const groups = service.getCollectionGroups();
            for (const g of groups) {
                if (g.id !== 'content') {
                    expect(g.contentTypeBundles).toBeUndefined();
                }
            }
        });
    });

    describe('expandBundleSelections', () => {
        it('should expand bundle into 3 flat configs', () => {
            const bundle: ContentTypeBundle = {
                contentTypeSlug: 'blog',
                contentTypeName: 'Blog',
                draftsCollection: { name: 'arc_blog_drafts', displayName: 'Blog (Drafts)' },
                publishedCollection: { name: 'arc_blog', displayName: 'Blog (Published)' },
                tagsCollection: { name: 'Tags_blog', displayName: 'Tags (Blog)' },
                referencedSlugs: [],
            };

            const result = service.expandBundleSelections([], [bundle]);
            expect(result).toHaveLength(3);
            expect(result.map((c) => c.name)).toEqual([
                'arc_blog_drafts',
                'arc_blog',
                'Tags_blog',
            ]);
        });

        it('should combine static collections with expanded bundles', () => {
            const staticCol: CollectionConfig = { name: 'Settings', displayName: 'Settings' };
            const bundle: ContentTypeBundle = {
                contentTypeSlug: 'news',
                contentTypeName: 'News',
                draftsCollection: { name: 'arc_news_drafts', displayName: 'News (Drafts)' },
                publishedCollection: { name: 'arc_news', displayName: 'News (Published)' },
                tagsCollection: { name: 'Tags_news', displayName: 'Tags (News)' },
                referencedSlugs: [],
            };

            const result = service.expandBundleSelections([staticCol], [bundle]);
            expect(result).toHaveLength(4);
            expect(result[0].name).toBe('Settings');
            expect(result[1].name).toBe('arc_news_drafts');
        });
    });

    describe('getCollectionCount', () => {
        it('should return the count from Firestore', async () => {
            const count = await service.getCollectionCount('DraftContents');
            expect(count).toBe(5);
        });
    });

    describe('exportCollections', () => {
        it('should export documents from each selected collection', async () => {
            const selected: CollectionConfig[] = [
                { name: 'ContentTypes', displayName: 'Content Types' },
            ];

            const progressSpy = vi.fn();
            const result = await service.exportCollections(selected, progressSpy);

            expect(result.collections['ContentTypes']).toBeDefined();
            expect(Object.keys(result.collections['ContentTypes'])).toHaveLength(2);
        });

        it('should preserve document IDs as keys', async () => {
            const selected: CollectionConfig[] = [
                { name: 'DraftContents', displayName: 'Draft Contents' },
            ];

            const result = await service.exportCollections(selected, vi.fn());

            expect(result.collections['DraftContents']['doc1']).toBeDefined();
            expect(result.collections['DraftContents']['doc2']).toBeDefined();
        });

        it('should serialize document data correctly', async () => {
            const selected: CollectionConfig[] = [
                { name: 'DraftContents', displayName: 'Draft Contents' },
            ];

            const result = await service.exportCollections(selected, vi.fn());

            expect(result.collections['DraftContents']['doc1']).toEqual({
                title: 'Test Doc 1',
                count: 10,
            });
        });

        it('should handle empty collections by returning empty object', async () => {
            const { getDocs } = await import('@angular/fire/firestore');
            (getDocs as any).mockResolvedValueOnce({ docs: [], size: 0 });

            const selected: CollectionConfig[] = [
                { name: 'EmptyCollection', displayName: 'Empty' },
            ];

            const result = await service.exportCollections(selected, vi.fn());

            expect(result.collections['EmptyCollection']).toEqual({});
        });

        it('should invoke progress callback correctly', async () => {
            const selected: CollectionConfig[] = [
                { name: 'ContentTypes', displayName: 'Content Types' },
                { name: 'DraftContents', displayName: 'Draft Contents' },
            ];

            const progressCalls: ExportProgress[] = [];
            await service.exportCollections(selected, (p) => progressCalls.push({ ...p }));

            // Should have progress updates: 1 for each collection start + 1 completion
            expect(progressCalls.length).toBeGreaterThanOrEqual(3);
            expect(progressCalls[0].currentCollection).toBe('Content Types');
            expect(progressCalls[0].collectionsCompleted).toBe(0);
            expect(progressCalls[progressCalls.length - 1].currentCollection).toBe('Complete');
        });

        it('should build correct metadata summary', async () => {
            const selected: CollectionConfig[] = [
                { name: 'ContentTypes', displayName: 'Content Types' },
            ];

            const result = await service.exportCollections(selected, vi.fn());

            expect(result.metadata.totalDocuments).toBe(2);
            expect(result.metadata.collectionSummary).toHaveLength(1);
            expect(result.metadata.collectionSummary[0]).toEqual({
                name: 'ContentTypes',
                count: 2,
            });
        });

        it('should set version and exportedAt in result', async () => {
            const selected: CollectionConfig[] = [
                { name: 'ContentTypes', displayName: 'Content Types' },
            ];

            const result = await service.exportCollections(selected, vi.fn());

            expect(result.version).toBe('1.0');
            expect(result.exportedAt).toBeTruthy();
            expect(() => new Date(result.exportedAt)).not.toThrow();
        });

        it('should export subcollections under parent path', async () => {
            const selected: CollectionConfig[] = [
                {
                    name: 'Waitlists',
                    displayName: 'Waitlists',
                    subcollections: [{ name: 'users', displayName: 'Waitlist Users' }],
                },
            ];

            const result = await service.exportCollections(selected, vi.fn());

            // Root collection should exist
            expect(result.collections['Waitlists']).toBeDefined();

            // Subcollection paths should exist for each parent doc
            // The mock returns doc1 and doc2 as parent docs
            expect(result.collections['Waitlists/doc1/users']).toBeDefined();
            expect(result.collections['Waitlists/doc2/users']).toBeDefined();
        });
    });

    describe('downloadAsJson', () => {
        it('should create a download link and trigger click', () => {
            const createElementSpy = vi.spyOn(document, 'createElement');
            const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
            const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

            const mockAnchor = {
                href: '',
                download: '',
                click: vi.fn(),
            } as any;
            createElementSpy.mockReturnValue(mockAnchor);
            vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor);
            vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor);

            const data: any = {
                version: '1.0',
                exportedAt: '2024-01-01',
                collections: {},
                metadata: { totalDocuments: 0, collectionSummary: [] },
            };

            service.downloadAsJson(data, 'test-export.json');

            expect(createObjectURLSpy).toHaveBeenCalled();
            expect(mockAnchor.download).toBe('test-export.json');
            expect(mockAnchor.click).toHaveBeenCalled();
            expect(revokeObjectURLSpy).toHaveBeenCalled();

            createElementSpy.mockRestore();
            createObjectURLSpy.mockRestore();
            revokeObjectURLSpy.mockRestore();
        });
    });
});
