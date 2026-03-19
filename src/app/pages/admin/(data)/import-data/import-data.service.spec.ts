import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Firestore } from '@angular/fire/firestore';
import { ImportDataService } from './import-data.service';
import { ExportFormat, ImportOptions, ImportProgress } from '../data-constants';

// Track setDoc and writeBatch calls
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual('@angular/fire/firestore');
    return {
        ...actual,
        doc: vi.fn((_db: any, ...pathSegments: string[]) => ({
            path: pathSegments.join('/'),
            id: pathSegments[pathSegments.length - 1],
        })),
        getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
        setDoc: vi.fn().mockResolvedValue(undefined),
        writeBatch: vi.fn(() => ({
            set: mockBatchSet,
            commit: mockBatchCommit,
        })),
    };
});

vi.mock('../data-serialization', () => ({
    deserializeFirestoreValue: vi.fn((value: any) => value),
}));

describe('ImportDataService', () => {
    let service: ImportDataService;

    const validExportData: ExportFormat = {
        version: '1.0',
        exportedAt: '2024-01-15T10:00:00.000Z',
        collections: {
            ContentTypes: {
                ct1: { name: 'Blog', slug: 'blog', fields: [] },
                ct2: { name: 'News', slug: 'news', fields: [] },
            },
            Settings: {
                s1: { siteName: 'Test Site', theme: 'dark' },
            },
        },
        metadata: {
            totalDocuments: 3,
            collectionSummary: [
                { name: 'ContentTypes', count: 2 },
                { name: 'Settings', count: 1 },
            ],
        },
    };

    beforeEach(async () => {
        vi.clearAllMocks();

        await TestBed.configureTestingModule({
            providers: [
                ImportDataService,
                { provide: Firestore, useValue: {} },
            ],
        }).compileComponents();

        service = TestBed.inject(ImportDataService);
    });

    describe('parseExportFile', () => {
        it('should parse valid JSON file', async () => {
            const file = new File(
                [JSON.stringify(validExportData)],
                'export.json',
                { type: 'application/json' },
            );

            const result = await service.parseExportFile(file);
            expect(result.version).toBe('1.0');
            expect(result.collections).toBeDefined();
            expect(Object.keys(result.collections)).toHaveLength(2);
        });

        it('should reject invalid JSON with error', async () => {
            const file = new File(
                ['not valid json {{{'],
                'invalid.json',
                { type: 'application/json' },
            );

            await expect(service.parseExportFile(file)).rejects.toThrow('Invalid JSON file');
        });

        it('should reject non-JSON content', async () => {
            const file = new File(
                ['<html><body>Hello</body></html>'],
                'page.html',
                { type: 'text/html' },
            );

            await expect(service.parseExportFile(file)).rejects.toThrow('Invalid JSON file');
        });
    });

    describe('validateExportData', () => {
        it('should accept valid ExportFormat', () => {
            const result = service.validateExportData(validExportData);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject missing version field', () => {
            const data = { ...validExportData, version: undefined };
            const result = service.validateExportData(data);
            expect(result.errors.some((e) => e.includes('version'))).toBe(true);
        });

        it('should reject missing collections field', () => {
            const data = { version: '1.0' };
            const result = service.validateExportData(data);
            expect(result.isValid).toBe(false);
            expect(result.errors.some((e) => e.includes('collections'))).toBe(true);
        });

        it('should warn about unknown collection names', () => {
            const data = {
                ...validExportData,
                collections: {
                    ...validExportData.collections,
                    SomeUnknownCollection: { doc1: {} },
                },
            };
            const result = service.validateExportData(data);
            expect(result.warnings.some((w) => w.includes('Unknown collection'))).toBe(true);
        });

        it('should warn about users collection Auth UID dependency', () => {
            const data = {
                ...validExportData,
                collections: {
                    ...validExportData.collections,
                    users: { user1: { uid: 'firebase-auth-uid', name: 'Admin' } },
                },
            };
            const result = service.validateExportData(data);
            expect(result.warnings.some((w) => w.includes('Auth UID'))).toBe(true);
        });

        it('should return correct collection summary', () => {
            const result = service.validateExportData(validExportData);
            expect(result.collectionSummary).toHaveLength(2);
            expect(result.collectionSummary[0]).toEqual({
                path: 'ContentTypes',
                documentCount: 2,
                isKnown: true,
            });
        });

        it('should recognize dynamic Tags_ collections as known', () => {
            const data = {
                ...validExportData,
                collections: {
                    Tags_blog: { tag1: { label: 'News' } },
                },
            };
            const result = service.validateExportData(data);
            const tagSummary = result.collectionSummary.find((c) => c.path === 'Tags_blog');
            expect(tagSummary?.isKnown).toBe(true);
        });

        it('should recognize arc_* published collections as known', () => {
            const data = {
                ...validExportData,
                collections: {
                    arc_articles: { doc1: { title: 'Article' } },
                },
            };
            const result = service.validateExportData(data);
            const summary = result.collectionSummary.find((c) => c.path === 'arc_articles');
            expect(summary?.isKnown).toBe(true);
            expect(result.warnings.every((w) => !w.includes('arc_articles'))).toBe(true);
        });

        it('should recognize arc_*_drafts collections as known', () => {
            const data = {
                ...validExportData,
                collections: {
                    arc_people_drafts: { doc1: { title: 'Draft' } },
                },
            };
            const result = service.validateExportData(data);
            const summary = result.collectionSummary.find((c) => c.path === 'arc_people_drafts');
            expect(summary?.isKnown).toBe(true);
            expect(result.warnings.every((w) => !w.includes('arc_people_drafts'))).toBe(true);
        });

        it('should still warn about truly unknown collections', () => {
            const data = {
                ...validExportData,
                collections: {
                    RandomStuff: { doc1: {} },
                },
            };
            const result = service.validateExportData(data);
            expect(result.warnings.some((w) => w.includes('RandomStuff'))).toBe(true);
        });
    });

    describe('importCollections', () => {
        const defaultOptions: ImportOptions = {
            overwriteExisting: true,
            skipExisting: false,
        };

        it('should use setDoc (via writeBatch.set) not addDoc', async () => {
            await service.importCollections(
                validExportData,
                ['ContentTypes'],
                defaultOptions,
                vi.fn(),
            );

            expect(mockBatchSet).toHaveBeenCalled();
            expect(mockBatchCommit).toHaveBeenCalled();
        });

        it('should preserve document IDs from JSON keys', async () => {
            const { doc: mockDoc } = await import('@angular/fire/firestore');

            await service.importCollections(
                validExportData,
                ['ContentTypes'],
                defaultOptions,
                vi.fn(),
            );

            // Verify doc was called with the original IDs from the JSON
            expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'ContentTypes', 'ct1');
            expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'ContentTypes', 'ct2');
        });

        it('should process in batches of 500', async () => {
            // Create data with 600 documents to force 2 batches
            const largeDocs: Record<string, any> = {};
            for (let i = 0; i < 600; i++) {
                largeDocs[`doc${i}`] = { title: `Doc ${i}` };
            }

            const largeExport: ExportFormat = {
                ...validExportData,
                collections: { TestCollection: largeDocs },
            };

            const { writeBatch: mockWriteBatch } = await import('@angular/fire/firestore');

            await service.importCollections(
                largeExport,
                ['TestCollection'],
                defaultOptions,
                vi.fn(),
            );

            // Should have created 2 batches (500 + 100)
            expect(mockWriteBatch).toHaveBeenCalledTimes(2);
        });

        it('should respect overwriteExisting option', async () => {
            await service.importCollections(
                validExportData,
                ['ContentTypes'],
                { overwriteExisting: true, skipExisting: false },
                vi.fn(),
            );

            // When overwriteExisting is true, batch.set is called without merge option
            expect(mockBatchSet).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
            );
        });

        it('should respect skipExisting option', async () => {
            const { getDoc } = await import('@angular/fire/firestore');
            (getDoc as any).mockResolvedValue({ exists: () => true });

            const result = await service.importCollections(
                validExportData,
                ['ContentTypes'],
                { overwriteExisting: false, skipExisting: true },
                vi.fn(),
            );

            expect(result.totalSkipped).toBe(2); // Both docs exist
            expect(result.totalImported).toBe(0);

            (getDoc as any).mockResolvedValue({ exists: () => false });
        });

        it('should deserialize __type values correctly', async () => {
            const { deserializeFirestoreValue } = await import('../data-serialization');

            await service.importCollections(
                validExportData,
                ['ContentTypes'],
                defaultOptions,
                vi.fn(),
            );

            expect(deserializeFirestoreValue).toHaveBeenCalled();
        });

        it('should handle subcollection paths correctly', async () => {
            const { doc: mockDoc } = await import('@angular/fire/firestore');

            const dataWithSub: ExportFormat = {
                ...validExportData,
                collections: {
                    'Waitlists/wl1/users': {
                        user1: { email: 'test@test.com' },
                    },
                },
            };

            await service.importCollections(
                dataWithSub,
                ['Waitlists/wl1/users'],
                defaultOptions,
                vi.fn(),
            );

            // Should use full path for subcollection
            expect(mockDoc).toHaveBeenCalledWith(
                expect.anything(),
                'Waitlists', 'wl1', 'users', 'user1',
            );
        });

        it('should report progress per collection', async () => {
            const progressCalls: ImportProgress[] = [];

            await service.importCollections(
                validExportData,
                ['ContentTypes', 'Settings'],
                defaultOptions,
                (p) => progressCalls.push({ ...p }),
            );

            expect(progressCalls.length).toBeGreaterThanOrEqual(3);
            expect(progressCalls[0].currentCollection).toBe('ContentTypes');
            expect(progressCalls[progressCalls.length - 1].currentCollection).toBe('Complete');
        });

        it('should handle write errors gracefully', async () => {
            mockBatchCommit.mockRejectedValueOnce(new Error('Write permission denied'));

            const result = await service.importCollections(
                validExportData,
                ['ContentTypes'],
                defaultOptions,
                vi.fn(),
            );

            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain('Batch commit failed');
        });

        it('should return correct import result summary', async () => {
            const result = await service.importCollections(
                validExportData,
                ['ContentTypes', 'Settings'],
                defaultOptions,
                vi.fn(),
            );

            expect(result.totalImported).toBe(3);
            expect(result.collectionResults).toHaveLength(2);
            expect(result.collectionResults[0].name).toBe('ContentTypes');
            expect(result.collectionResults[0].imported).toBe(2);
        });
    });
});
