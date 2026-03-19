import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import ImportDataPageComponent from './import-data.page';
import { ImportDataService } from './import-data.service';
import { ExportFormat, ImportValidationResult } from '../data-constants';

describe('ImportDataPageComponent', () => {
    let component: ImportDataPageComponent;
    let fixture: ComponentFixture<ImportDataPageComponent>;
    let mockImportService: any;

    const validExportData: ExportFormat = {
        version: '1.0',
        exportedAt: '2024-01-15T10:00:00.000Z',
        collections: {
            ContentTypes: { ct1: { name: 'Blog' }, ct2: { name: 'News' } },
            Settings: { s1: { siteName: 'Test' } },
        },
        metadata: { totalDocuments: 3, collectionSummary: [] },
    };

    const validValidation: ImportValidationResult = {
        isValid: true,
        version: '1.0',
        errors: [],
        warnings: [],
        collectionSummary: [
            { path: 'ContentTypes', documentCount: 2, isKnown: true },
            { path: 'Settings', documentCount: 1, isKnown: true },
        ],
    };

    beforeEach(async () => {
        mockImportService = {
            parseExportFile: vi.fn().mockResolvedValue(validExportData),
            validateExportData: vi.fn().mockReturnValue(validValidation),
            importCollections: vi.fn().mockResolvedValue({
                totalImported: 3,
                totalSkipped: 0,
                totalErrored: 0,
                errors: [],
                collectionResults: [
                    { name: 'ContentTypes', imported: 2, skipped: 0, errors: 0 },
                    { name: 'Settings', imported: 1, skipped: 0, errors: 0 },
                ],
            }),
        };

        await TestBed.configureTestingModule({
            imports: [
                ImportDataPageComponent,
                NoopAnimationsModule,
            ],
            providers: [
                provideRouter([]),
                { provide: Firestore, useValue: {} },
                { provide: ImportDataService, useValue: mockImportService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ImportDataPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should start at step 1', () => {
        expect(component.currentStep()).toBe(1);
    });

    it('should advance to step 2 when valid file is selected', async () => {
        const file = new File(['{}'], 'export.json', { type: 'application/json' });
        const event = { target: { files: [file] } } as any;

        await component.onFileSelected(event);

        expect(component.currentStep()).toBe(2);
        expect(mockImportService.parseExportFile).toHaveBeenCalledWith(file);
        expect(mockImportService.validateExportData).toHaveBeenCalled();
    });

    it('should show error and stay on step 1 when invalid file is selected', async () => {
        mockImportService.parseExportFile.mockRejectedValueOnce(new Error('Invalid JSON'));

        const file = new File(['not json'], 'bad.json', { type: 'application/json' });
        const event = { target: { files: [file] } } as any;

        await component.onFileSelected(event);

        expect(component.currentStep()).toBe(1);
        expect(component.parseError()).toBe('Invalid JSON');
    });

    it('should show validation errors and stay on step 1 when validation fails', async () => {
        mockImportService.validateExportData.mockReturnValueOnce({
            isValid: false,
            version: 'unknown',
            errors: ['Missing version'],
            warnings: [],
            collectionSummary: [],
        });

        const file = new File(['{}'], 'export.json', { type: 'application/json' });
        const event = { target: { files: [file] } } as any;

        await component.onFileSelected(event);

        expect(component.currentStep()).toBe(1);
        expect(component.parseError()).toContain('Missing version');
    });

    it('should auto-select all collections on step 2', async () => {
        const file = new File(['{}'], 'export.json', { type: 'application/json' });
        await component.onFileSelected({ target: { files: [file] } } as any);

        expect(component.selectedCount).toBe(2);
    });

    it('should toggle individual collection selection', async () => {
        const file = new File(['{}'], 'export.json', { type: 'application/json' });
        await component.onFileSelected({ target: { files: [file] } } as any);

        component.toggleCollection('ContentTypes');
        expect(component.selectedCollections().has('ContentTypes')).toBe(false);
        expect(component.selectedCount).toBe(1);
    });

    it('should toggle all collections', async () => {
        const file = new File(['{}'], 'export.json', { type: 'application/json' });
        await component.onFileSelected({ target: { files: [file] } } as any);

        component.toggleAllCollections(false);
        expect(component.selectedCount).toBe(0);

        component.toggleAllCollections(true);
        expect(component.selectedCount).toBe(2);
    });

    it('should call importCollections when import starts', async () => {
        const file = new File(['{}'], 'export.json', { type: 'application/json' });
        await component.onFileSelected({ target: { files: [file] } } as any);

        await component.startImport();

        expect(mockImportService.importCollections).toHaveBeenCalledWith(
            validExportData,
            expect.arrayContaining(['ContentTypes', 'Settings']),
            expect.objectContaining({ skipExisting: true }),
            expect.any(Function),
        );
    });

    it('should advance to step 3 during import', async () => {
        const file = new File(['{}'], 'export.json', { type: 'application/json' });
        await component.onFileSelected({ target: { files: [file] } } as any);

        await component.startImport();

        expect(component.currentStep()).toBe(3);
    });

    it('should show import result summary after completion', async () => {
        const file = new File(['{}'], 'export.json', { type: 'application/json' });
        await component.onFileSelected({ target: { files: [file] } } as any);

        await component.startImport();

        expect(component.importResult()).toBeTruthy();
        expect(component.importResult()!.totalImported).toBe(3);
    });

    it('should go back to previous step', async () => {
        const file = new File(['{}'], 'export.json', { type: 'application/json' });
        await component.onFileSelected({ target: { files: [file] } } as any);

        expect(component.currentStep()).toBe(2);

        component.goBack();
        expect(component.currentStep()).toBe(1);
    });

    it('should reset all state on resetImport', async () => {
        const file = new File(['{}'], 'export.json', { type: 'application/json' });
        await component.onFileSelected({ target: { files: [file] } } as any);
        await component.startImport();

        component.resetImport();

        expect(component.currentStep()).toBe(1);
        expect(component.selectedFile()).toBeNull();
        expect(component.parsedData()).toBeNull();
        expect(component.importResult()).toBeNull();
    });

    // Grouped import collections
    describe('getGroupedImportCollections', () => {
        const groupedValidation: any = {
            isValid: true,
            version: '1.0',
            errors: [],
            warnings: [],
            collectionSummary: [
                { path: 'ContentTypes', documentCount: 5, isKnown: true },
                { path: 'arc_articles_drafts', documentCount: 10, isKnown: true },
                { path: 'arc_articles', documentCount: 8, isKnown: true },
                { path: 'Tags_articles', documentCount: 3, isKnown: true },
                { path: 'users', documentCount: 20, isKnown: true },
                { path: 'Settings', documentCount: 1, isKnown: true },
                { path: 'RandomCollection', documentCount: 2, isKnown: false },
            ],
        };

        it('should group arc_* collections into content group', async () => {
            mockImportService.validateExportData.mockReturnValue(groupedValidation);
            const file = new File(['{}'], 'export.json', { type: 'application/json' });
            await component.onFileSelected({ target: { files: [file] } } as any);

            const groups = component.getGroupedImportCollections();
            const contentGroup = groups.find((g) => g.id === 'content');

            expect(contentGroup).toBeTruthy();
            expect(contentGroup!.items.some((i) => i.path === 'arc_articles_drafts')).toBe(true);
            expect(contentGroup!.items.some((i) => i.path === 'arc_articles')).toBe(true);
            expect(contentGroup!.items.some((i) => i.path === 'Tags_articles')).toBe(true);
            expect(contentGroup!.items.some((i) => i.path === 'ContentTypes')).toBe(true);
        });

        it('should put unknown collections in "unknown" group', async () => {
            mockImportService.validateExportData.mockReturnValue(groupedValidation);
            const file = new File(['{}'], 'export.json', { type: 'application/json' });
            await component.onFileSelected({ target: { files: [file] } } as any);

            const groups = component.getGroupedImportCollections();
            const unknownGroup = groups.find((g) => g.id === 'unknown');

            expect(unknownGroup).toBeTruthy();
            expect(unknownGroup!.items.some((i) => i.path === 'RandomCollection')).toBe(true);
        });
    });

    describe('toggleImportGroup', () => {
        it('should select all collections in a group', async () => {
            const file = new File(['{}'], 'export.json', { type: 'application/json' });
            await component.onFileSelected({ target: { files: [file] } } as any);

            const groups = component.getGroupedImportCollections();
            if (groups.length > 0) {
                // First deselect all
                component.toggleAllCollections(false);

                // Select just first group
                component.toggleImportGroup(groups[0], true);

                for (const item of groups[0].items) {
                    expect(component.selectedCollections().has(item.path)).toBe(true);
                }
            }
        });

        it('should deselect all collections in a group', async () => {
            const file = new File(['{}'], 'export.json', { type: 'application/json' });
            await component.onFileSelected({ target: { files: [file] } } as any);

            const groups = component.getGroupedImportCollections();
            if (groups.length > 0) {
                component.toggleImportGroup(groups[0], false);

                for (const item of groups[0].items) {
                    expect(component.selectedCollections().has(item.path)).toBe(false);
                }
            }
        });
    });
});
