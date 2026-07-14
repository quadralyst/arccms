import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CollectionRefSyncService } from './collection-ref-sync.service';
import { ContentTypeField, CollectionReferenceConfig } from '../content-types/content-types.model';

// ── Mock Firestore module ────────────────────────────────────────────────
const mockCommit = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn();
const mockBatch = { update: mockUpdate, commit: mockCommit };

const mockCollection = vi.fn().mockReturnValue('mockCollectionRef');
const mockQuery = vi.fn().mockReturnValue('mockQuery');
const mockWhere = vi.fn().mockReturnValue('mockWhere');
const mockWriteBatch = vi.fn().mockReturnValue(mockBatch);
const mockDoc = vi.fn().mockReturnValue('mockDocRef');
const mockGetDocs = vi.fn().mockResolvedValue({ empty: true, docs: [] });

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    collection: (...args: any[]) => mockCollection(...args),
    getDocs: (...args: any[]) => mockGetDocs(...args),
    query: (...args: any[]) => mockQuery(...args),
    where: (...args: any[]) => mockWhere(...args),
    writeBatch: (...args: any[]) => mockWriteBatch(...args),
    doc: (...args: any[]) => mockDoc(...args),
}));

vi.mock('@angular/core', () => ({
    Injectable: () => (target: any) => target,
    inject: () => ({}),
    Injector: class {},
    runInInjectionContext: (_injector: any, fn: () => any) => fn(),
}));

vi.mock('../content-types/content-types.store', () => ({
    ContentTypesStore: class {},
}));

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a service instance bypassing Angular DI */
function createService(contentTypes: any[] = []): CollectionRefSyncService {
    const service = Object.create(CollectionRefSyncService.prototype);
    service.db = {};
    service.contentTypesStore = { items: vi.fn().mockReturnValue(contentTypes) };
    service.activeSyncs = new Set<string>();
    return service;
}

/** Build a minimal ContentTypeField with collection ref */
function makeRefField(overrides: Partial<ContentTypeField> & { collectionRef: CollectionReferenceConfig }): ContentTypeField {
    return {
        key: 'authorRef',
        label: 'Author',
        type: 'dropdown',
        required: false,
        order: 1,
        useCollectionRef: true,
        ...overrides,
    } as ContentTypeField;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('CollectionRefSyncService', () => {
    let service: CollectionRefSyncService;

    beforeEach(() => {
        service = createService();
        vi.clearAllMocks();
    });

    // ── getValue ─────────────────────────────────────────────────────────

    describe('getValue', () => {
        it('should return a top-level property value', () => {
            const data = { title: 'Hello', status: 'draft' };
            expect(service.getValue(data, 'title')).toBe('Hello');
            expect(service.getValue(data, 'status')).toBe('draft');
        });

        it('should return a value from customFields when not at top level', () => {
            const data = { customFields: { bio: 'Some bio text' } };
            expect(service.getValue(data, 'bio')).toBe('Some bio text');
        });

        it('should prefer top-level value over customFields when both exist', () => {
            const data = { name: 'top-level', customFields: { name: 'nested' } };
            expect(service.getValue(data, 'name')).toBe('top-level');
        });

        it('should return undefined when key exists in neither top-level nor customFields', () => {
            const data = { title: 'Hello', customFields: { bio: 'text' } };
            expect(service.getValue(data, 'missing')).toBeUndefined();
        });

        it('should return undefined when data has no customFields and key is missing', () => {
            const data = { title: 'Hello' };
            expect(service.getValue(data, 'missing')).toBeUndefined();
        });

        it('should return falsy values correctly (0, empty string, false, null)', () => {
            const data = { count: 0, label: '', active: false, value: null };
            expect(service.getValue(data, 'count')).toBe(0);
            expect(service.getValue(data, 'label')).toBe('');
            expect(service.getValue(data, 'active')).toBe(false);
            expect(service.getValue(data, 'value')).toBe(null);
        });

        it('should return falsy values from customFields correctly', () => {
            const data = { customFields: { count: 0, active: false } };
            expect(service.getValue(data, 'count')).toBe(0);
            expect(service.getValue(data, 'active')).toBe(false);
        });

        it('should handle empty data object', () => {
            expect(service.getValue({}, 'anything')).toBeUndefined();
        });

        it('should handle customFields being an empty object', () => {
            const data = { customFields: {} };
            expect(service.getValue(data, 'missing')).toBeUndefined();
        });
    });

    // ── buildRefData ─────────────────────────────────────────────────────

    describe('buildRefData', () => {
        const baseField = makeRefField({
            key: 'authorRef',
            collectionRef: {
                collectionSlug: 'authors',
                collectionName: 'Authors',
                displayField: 'name',
                valueField: 'id',
                syncFields: ['urlSlug', 'coverImage'],
            },
        });

        it('should include the source document id', () => {
            const result = service.buildRefData(baseField, 'doc123', { name: 'Alice' });
            expect(result.id).toBe('doc123');
            expect(result._refId).toBe('doc123');
        });

        it('should include the display field value from top-level data', () => {
            const result = service.buildRefData(baseField, 'doc1', { name: 'Alice' });
            expect(result.name).toBe('Alice');
            expect(result._refDisplayValue).toBe('Alice');
        });

        it('should fall back to title when display field is missing', () => {
            const result = service.buildRefData(baseField, 'doc1', { title: 'Fallback Title' });
            expect(result.name).toBe('Fallback Title');
            expect(result._refDisplayValue).toBe('Fallback Title');
        });

        it('should fall back to sourceDocId when both display field and title are missing', () => {
            const result = service.buildRefData(baseField, 'doc1', {});
            expect(result.name).toBe('doc1');
            expect(result._refDisplayValue).toBe('doc1');
        });

        it('should include _refCollection metadata', () => {
            const result = service.buildRefData(baseField, 'doc1', { name: 'Alice' });
            expect(result._refCollection).toBe('authors');
        });

        it('should include sync fields from top-level data', () => {
            const updatedData = { name: 'Alice', urlSlug: 'alice', coverImage: 'img.jpg' };
            const result = service.buildRefData(baseField, 'doc1', updatedData);
            expect(result.urlSlug).toBe('alice');
            expect(result.coverImage).toBe('img.jpg');
        });

        it('should include sync fields from customFields when not at top level', () => {
            const updatedData = { name: 'Alice', customFields: { urlSlug: 'alice-custom', coverImage: 'custom.jpg' } };
            const result = service.buildRefData(baseField, 'doc1', updatedData);
            expect(result.urlSlug).toBe('alice-custom');
            expect(result.coverImage).toBe('custom.jpg');
        });

        it('should prefer top-level sync field over customFields', () => {
            const updatedData = { name: 'Alice', urlSlug: 'top', customFields: { urlSlug: 'nested' } };
            const result = service.buildRefData(baseField, 'doc1', updatedData);
            expect(result.urlSlug).toBe('top');
        });

        it('should omit sync fields that are not present in data at all', () => {
            const updatedData = { name: 'Alice' }; // no urlSlug, no coverImage
            const result = service.buildRefData(baseField, 'doc1', updatedData);
            expect(result).not.toHaveProperty('urlSlug');
            expect(result).not.toHaveProperty('coverImage');
        });

        it('should handle empty syncFields array', () => {
            const field = makeRefField({
                collectionRef: {
                    collectionSlug: 'tags',
                    collectionName: 'Tags',
                    displayField: 'label',
                    valueField: 'id',
                    syncFields: [],
                },
            });
            const result = service.buildRefData(field, 'tag1', { label: 'JavaScript' });
            expect(result).toEqual({
                id: 'tag1',
                label: 'JavaScript',
                _refCollection: 'tags',
                _refId: 'tag1',
                _refDisplayValue: 'JavaScript',
            });
        });

        it('should produce the complete expected shape with all fields present', () => {
            const updatedData = { name: 'Bob', urlSlug: 'bob', coverImage: 'bob.png' };
            const result = service.buildRefData(baseField, 'author-bob', updatedData);
            expect(result).toEqual({
                id: 'author-bob',
                name: 'Bob',
                urlSlug: 'bob',
                coverImage: 'bob.png',
                _refCollection: 'authors',
                _refId: 'author-bob',
                _refDisplayValue: 'Bob',
            });
        });
    });

    // ── syncReferencedData ───────────────────────────────────────────────

    describe('syncReferencedData', () => {

        // -- Circular reference guard --

        describe('circular reference guard', () => {
            it('should prevent re-entrant sync for the same document', async () => {
                // Manually add a sync key to simulate an in-progress sync
                (service as any).activeSyncs.add('articles:doc1');

                const itemsSpy = (service as any).contentTypesStore.items;
                await service.syncReferencedData('articles', 'doc1', { title: 'Test' });

                // contentTypesStore.items should never be called because the guard returned early
                expect(itemsSpy).not.toHaveBeenCalled();
            });

            it('should allow sync for a different document even when one is active', async () => {
                (service as any).activeSyncs.add('articles:doc1');

                const itemsSpy = (service as any).contentTypesStore.items;
                await service.syncReferencedData('articles', 'doc2', { title: 'Test' });

                // doc2 is a different key, so processing should proceed
                expect(itemsSpy).toHaveBeenCalled();
            });

            it('should clean up the sync key after processing completes', async () => {
                await service.syncReferencedData('articles', 'doc1', { title: 'Test' });
                expect((service as any).activeSyncs.has('articles:doc1')).toBe(false);
            });

            it('should clean up the sync key even if processing throws', async () => {
                (service as any).contentTypesStore.items = vi.fn().mockImplementation(() => {
                    throw new Error('store error');
                });

                await expect(
                    service.syncReferencedData('articles', 'doc1', { title: 'Test' })
                ).rejects.toThrow('store error');

                expect((service as any).activeSyncs.has('articles:doc1')).toBe(false);
            });
        });

        // -- No referencing types --

        describe('when no referencing content types exist', () => {
            it('should return early without querying Firestore', async () => {
                service = createService([
                    { slug: 'pages', fields: [{ key: 'body', type: 'richtext', useCollectionRef: false }] },
                ]);

                await service.syncReferencedData('authors', 'auth1', { name: 'Alice' });

                expect(mockGetDocs).not.toHaveBeenCalled();
            });

            it('should return early when content types have no fields', async () => {
                service = createService([{ slug: 'empty', fields: [] }]);

                await service.syncReferencedData('authors', 'auth1', { name: 'Alice' });

                expect(mockGetDocs).not.toHaveBeenCalled();
            });
        });

        // -- Change detection / optimization --

        describe('change detection optimization', () => {
            const authorField: ContentTypeField = makeRefField({
                key: 'authorRef',
                collectionRef: {
                    collectionSlug: 'authors',
                    collectionName: 'Authors',
                    displayField: 'name',
                    valueField: 'id',
                    syncFields: ['urlSlug'],
                },
            });

            const contentTypeWithAuthorRef = {
                slug: 'articles',
                fields: [authorField],
            };

            it('should skip sync when originalData is provided and no relevant fields changed', async () => {
                service = createService([contentTypeWithAuthorRef]);

                const originalData = { name: 'Alice', title: 'T', urlSlug: 'alice', coverImage: 'img.jpg' };
                const updatedData = { ...originalData }; // identical

                await service.syncReferencedData('authors', 'auth1', updatedData, originalData);

                expect(mockGetDocs).not.toHaveBeenCalled();
            });

            it('should proceed with sync when a sync field changed', async () => {
                service = createService([contentTypeWithAuthorRef]);

                mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] })
                           .mockResolvedValueOnce({ empty: true, docs: [] });

                const originalData = { name: 'Alice', urlSlug: 'alice' };
                const updatedData = { name: 'Alice Updated', urlSlug: 'alice' };

                await service.syncReferencedData('authors', 'auth1', updatedData, originalData);

                // Should have queried Firestore (called for both DraftContents and Contents)
                expect(mockGetDocs).toHaveBeenCalled();
            });

            it('should proceed with sync when title changed', async () => {
                service = createService([contentTypeWithAuthorRef]);

                mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] })
                           .mockResolvedValueOnce({ empty: true, docs: [] });

                const originalData = { name: 'Alice', title: 'Old Title', urlSlug: 'alice' };
                const updatedData = { name: 'Alice', title: 'New Title', urlSlug: 'alice' };

                await service.syncReferencedData('authors', 'auth1', updatedData, originalData);

                expect(mockGetDocs).toHaveBeenCalled();
            });

            it('should proceed when no originalData is provided (no optimization)', async () => {
                service = createService([contentTypeWithAuthorRef]);

                mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] })
                           .mockResolvedValueOnce({ empty: true, docs: [] });

                await service.syncReferencedData('authors', 'auth1', { name: 'Alice' });

                expect(mockGetDocs).toHaveBeenCalled();
            });

            it('should detect changes in customFields correctly', async () => {
                service = createService([contentTypeWithAuthorRef]);

                mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] })
                           .mockResolvedValueOnce({ empty: true, docs: [] });

                const originalData = { customFields: { urlSlug: 'old-slug' } };
                const updatedData = { customFields: { urlSlug: 'new-slug' } };

                await service.syncReferencedData('authors', 'auth1', updatedData, originalData);

                expect(mockGetDocs).toHaveBeenCalled();
            });
        });

        // -- Syncs both draft and published collections --

        describe('dual-collection sync (arc_{slug}_drafts and arc_{slug})', () => {
            const authorField: ContentTypeField = makeRefField({
                key: 'authorRef',
                collectionRef: {
                    collectionSlug: 'authors',
                    collectionName: 'Authors',
                    displayField: 'name',
                    valueField: 'id',
                    syncFields: [],
                },
            });

            const contentTypeWithRef = {
                slug: 'articles',
                fields: [authorField],
            };

            it('should query both DraftContents and Contents collections', async () => {
                service = createService([contentTypeWithRef]);

                mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

                await service.syncReferencedData('authors', 'auth1', { name: 'Alice' });

                // collection() should be called with 'arc_articles_drafts' and 'arc_articles'
                expect(mockCollection).toHaveBeenCalledWith({}, 'arc_articles_drafts');
                expect(mockCollection).toHaveBeenCalledWith({}, 'arc_articles');
            });

            it('should use equality query for dropdown field type', async () => {
                service = createService([contentTypeWithRef]);

                mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

                await service.syncReferencedData('authors', 'auth1', { name: 'Alice' });

                expect(mockWhere).toHaveBeenCalledWith('customFields.authorRef', '==', 'auth1');
            });

            it('should use array-contains query for checkbox field type', async () => {
                const checkboxField = makeRefField({
                    key: 'tagsRef',
                    type: 'checkbox',
                    collectionRef: {
                        collectionSlug: 'tags',
                        collectionName: 'Tags',
                        displayField: 'label',
                        valueField: 'id',
                        syncFields: [],
                    },
                });

                service = createService([{ slug: 'articles', fields: [checkboxField] }]);
                mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

                await service.syncReferencedData('tags', 'tag1', { label: 'JavaScript' });

                expect(mockWhere).toHaveBeenCalledWith('customFields.tagsRef', 'array-contains', 'tag1');
            });
        });

        // -- Batch updates --

        describe('batch updates for referencing documents', () => {
            const authorField: ContentTypeField = makeRefField({
                key: 'authorRef',
                collectionRef: {
                    collectionSlug: 'authors',
                    collectionName: 'Authors',
                    displayField: 'name',
                    valueField: 'id',
                    syncFields: ['urlSlug'],
                },
            });

            const contentTypeWithRef = {
                slug: 'articles',
                fields: [authorField],
            };

            it('should batch-update documents that reference the source doc (dropdown)', async () => {
                service = createService([contentTypeWithRef]);

                const mockDocSnap = {
                    id: 'article1',
                    data: () => ({ customFields: { authorRef: 'auth1', _ref_authorRef: { id: 'auth1', name: 'Old Name' } } }),
                };

                mockGetDocs.mockResolvedValue({ empty: false, docs: [mockDocSnap] });

                await service.syncReferencedData('authors', 'auth1', { name: 'New Name', urlSlug: 'new-slug' });

                // writeBatch should have been called (for each collection that had docs)
                expect(mockWriteBatch).toHaveBeenCalled();
                expect(mockUpdate).toHaveBeenCalled();
                expect(mockCommit).toHaveBeenCalled();

                // Verify update was called with the ref data shape
                const updateCall = mockUpdate.mock.calls[0];
                expect(updateCall[1]).toHaveProperty('customFields._ref_authorRef');
                expect(updateCall[1]['customFields._ref_authorRef']).toMatchObject({
                    id: 'auth1',
                    name: 'New Name',
                    urlSlug: 'new-slug',
                    _refCollection: 'authors',
                    _refId: 'auth1',
                    _refDisplayValue: 'New Name',
                });
                expect(updateCall[1]).toHaveProperty('modifiedAt');
            });

            it('should batch-update documents that reference the source doc (checkbox / array)', async () => {
                const checkboxField = makeRefField({
                    key: 'tagsRef',
                    type: 'checkbox',
                    collectionRef: {
                        collectionSlug: 'tags',
                        collectionName: 'Tags',
                        displayField: 'label',
                        valueField: 'id',
                        syncFields: [],
                    },
                });

                service = createService([{ slug: 'articles', fields: [checkboxField] }]);

                const existingRefArray = [
                    { id: 'tag1', label: 'Old Label', _refCollection: 'tags', _refId: 'tag1', _refDisplayValue: 'Old Label' },
                    { id: 'tag2', label: 'Other Tag', _refCollection: 'tags', _refId: 'tag2', _refDisplayValue: 'Other Tag' },
                ];

                const mockDocSnap = {
                    id: 'article1',
                    data: () => ({ customFields: { tagsRef: ['tag1', 'tag2'], _ref_tagsRef: existingRefArray } }),
                };

                mockGetDocs.mockResolvedValue({ empty: false, docs: [mockDocSnap] });

                await service.syncReferencedData('tags', 'tag1', { label: 'Updated Label' });

                expect(mockUpdate).toHaveBeenCalled();

                // For checkbox type, the update should contain an updated array
                const updateCall = mockUpdate.mock.calls[0];
                const updatedArray = updateCall[1]['customFields._ref_tagsRef'];
                expect(Array.isArray(updatedArray)).toBe(true);

                // The tag1 entry should be updated, tag2 should remain unchanged
                const tag1Entry = updatedArray.find((e: any) => e.id === 'tag1');
                expect(tag1Entry).toMatchObject({
                    id: 'tag1',
                    label: 'Updated Label',
                    _refCollection: 'tags',
                    _refId: 'tag1',
                    _refDisplayValue: 'Updated Label',
                });

                const tag2Entry = updatedArray.find((e: any) => e.id === 'tag2');
                expect(tag2Entry).toMatchObject({
                    id: 'tag2',
                    label: 'Other Tag',
                });
            });

            it('should not call writeBatch when snapshot is empty', async () => {
                service = createService([contentTypeWithRef]);

                mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

                await service.syncReferencedData('authors', 'auth1', { name: 'Alice' });

                expect(mockWriteBatch).not.toHaveBeenCalled();
            });

            it('should process documents in chunks of 400', async () => {
                service = createService([contentTypeWithRef]);

                // Create 450 mock docs to trigger chunking (400 + 50)
                const mockDocs = Array.from({ length: 450 }, (_, i) => ({
                    id: `article${i}`,
                    data: () => ({ customFields: { authorRef: 'auth1' } }),
                }));

                // First call (DraftContents) returns 450 docs, second (Contents) returns empty
                mockGetDocs.mockResolvedValueOnce({ empty: false, docs: mockDocs })
                           .mockResolvedValueOnce({ empty: true, docs: [] });

                await service.syncReferencedData('authors', 'auth1', { name: 'Alice' });

                // Should have created 2 batches for the 450 docs (400 + 50)
                expect(mockWriteBatch).toHaveBeenCalledTimes(2);
                expect(mockCommit).toHaveBeenCalledTimes(2);
            });
        });

        // -- Multiple referencing fields / content types --

        describe('multiple referencing fields and content types', () => {
            it('should process all content types that reference the source collection', async () => {
                const authorField = makeRefField({
                    key: 'authorRef',
                    collectionRef: {
                        collectionSlug: 'authors',
                        collectionName: 'Authors',
                        displayField: 'name',
                        valueField: 'id',
                        syncFields: [],
                    },
                });

                const editorField = makeRefField({
                    key: 'editorRef',
                    collectionRef: {
                        collectionSlug: 'authors',
                        collectionName: 'Authors',
                        displayField: 'name',
                        valueField: 'id',
                        syncFields: [],
                    },
                });

                service = createService([
                    { slug: 'articles', fields: [authorField] },
                    { slug: 'reviews', fields: [editorField] },
                ]);

                mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

                await service.syncReferencedData('authors', 'auth1', { name: 'Alice' });

                // Should query for both articles.authorRef and reviews.editorRef,
                // each targeting both DraftContents and Contents = 4 total queries
                expect(mockGetDocs).toHaveBeenCalledTimes(4);
            });

            it('should only process fields that reference the source collection', async () => {
                const authorField = makeRefField({
                    key: 'authorRef',
                    collectionRef: {
                        collectionSlug: 'authors',
                        collectionName: 'Authors',
                        displayField: 'name',
                        valueField: 'id',
                        syncFields: [],
                    },
                });

                const categoryField = makeRefField({
                    key: 'categoryRef',
                    collectionRef: {
                        collectionSlug: 'categories',
                        collectionName: 'Categories',
                        displayField: 'name',
                        valueField: 'id',
                        syncFields: [],
                    },
                });

                service = createService([
                    { slug: 'articles', fields: [authorField, categoryField] },
                ]);

                mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

                await service.syncReferencedData('authors', 'auth1', { name: 'Alice' });

                // Only authorRef should be queried (2 calls: DraftContents + Contents)
                // categoryRef should NOT be queried since source is 'authors'
                expect(mockGetDocs).toHaveBeenCalledTimes(2);
                expect(mockWhere).toHaveBeenCalledWith('customFields.authorRef', '==', 'auth1');
                expect(mockWhere).not.toHaveBeenCalledWith(
                    'customFields.categoryRef',
                    expect.anything(),
                    expect.anything()
                );
            });
        });
    });
});
