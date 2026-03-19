
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BulkImportDialogComponent } from './bulk-import-dialog.component';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BulkImportService, ParsedFile } from './bulk-import.service';
import { ContentTypesStore } from '../content-types/content-types.store';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PublishQueueService } from '../publish-queue/publish-queue.service';

// Mocks
const mockBulkImportService = {
    parseFile: vi.fn(),
    autoMapColumns: vi.fn(),
    validateRow: vi.fn(),
    buildContentItem: vi.fn(),
    suggestFieldType: vi.fn(),
    downloadSampleTemplate: vi.fn()
};

const mockContentTypesStore = {
    items: signal([
        { 
            id: '1', 
            slug: 'articles', 
            name: 'Articles', 
            singularName: 'Article', 
            fields: [], 
            order: 0 
        }
    ]),
    getAll: vi.fn(),
    update: vi.fn().mockReturnValue(of(undefined))
};

const mockDraftContentsStore = {
    addBatch: vi.fn().mockReturnValue(of(['id1', 'id2']))
};

const mockDialogRef = {
    close: vi.fn()
};

const mockSnackBar = {
    open: vi.fn()
};

describe('BulkImportDialogComponent', () => {
    let component: BulkImportDialogComponent;
    let fixture: ComponentFixture<BulkImportDialogComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [BulkImportDialogComponent, NoopAnimationsModule],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: { contentTypeSlug: 'articles' } },
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: BulkImportService, useValue: mockBulkImportService },
                { provide: ContentTypesStore, useValue: mockContentTypesStore },
                { provide: DraftContentsStore, useValue: mockDraftContentsStore },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: PublishQueueService, useValue: { enqueue: vi.fn().mockResolvedValue(undefined) } }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(BulkImportDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });
    
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should process file selection', async () => {
        const file = new File([''], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const mockParsed: ParsedFile = { headers: ['Title'], rows: [{'Title': 'A'}], totalRows: 1 };
        
        mockBulkImportService.parseFile.mockResolvedValue(mockParsed);
        mockBulkImportService.autoMapColumns.mockReturnValue([{ fileHeader: 'Title', targetField: 'title' }]);
        
        await component.processFile(file);
        
        expect(component.selectedFile()).toBe(file);
        expect(component.parsedFile()).toBe(mockParsed);
        expect(component.columnMappings().length).toBe(1);
        expect(component.currentStep()).toBe(2);
    });

    it('should handle file parse error', async () => {
        mockBulkImportService.parseFile.mockRejectedValue(new Error('Invalid file'));
        const file = new File([''], 'bad.txt');
        
        await component.processFile(file);
        
        expect(mockSnackBar.open).toHaveBeenCalledWith(expect.stringContaining('Failed'), expect.any(String), expect.any(Object));
        expect(component.selectedFile()).toBeNull();
    });

    it('should create custom field', () => {
        // Setup state
        const mockParsed: ParsedFile = { headers: ['Unknown'], rows: [{'Unknown': 'Value'}], totalRows: 1 };
        component.parsedFile.set(mockParsed);
        component.columnMappings.set([{ fileHeader: 'Unknown', targetField: '', isCustomField: false }]);
        
        mockBulkImportService.suggestFieldType.mockReturnValue('text');
        
        component.createCustomField('Unknown');
        
        expect(mockContentTypesStore.update).toHaveBeenCalled();
        const callArgs = mockContentTypesStore.update.mock.calls[0];
        expect(callArgs[0]).toBe('1'); // ID from mock store
        expect(callArgs[1].fields.length).toBe(1);
        expect(callArgs[1].fields[0].key).toBe('unknown');
        
        // Should update mapping
        const mapping = component.columnMappings()[0];
        expect(mapping.targetField).toBe('unknown');
        expect(mapping.isCustomField).toBe(true);
    });

    it('should validate and proceed to preview', () => {
        const mockParsed: ParsedFile = { headers: ['Title'], rows: [{'Title': 'A'}], totalRows: 1 };
        component.parsedFile.set(mockParsed);
        component.columnMappings.set([{ fileHeader: 'Title', targetField: 'title', isCustomField: false }]);
        component.currentStep.set(2);
        
        mockBulkImportService.validateRow.mockReturnValue({ valid: true, errors: {} });
        
        component.validateAndPreview();
        
        expect(mockBulkImportService.validateRow).toHaveBeenCalled();
        expect(component.validationSummary()?.validCount).toBe(1);
        expect(component.currentStep()).toBe(3);
    });

    it('should import draft content', () => {
        // Setup valid state
        component.currentStep.set(3);
        const mockParsed: ParsedFile = { headers: ['Title'], rows: [{'Title': 'A'}], totalRows: 1 };
        component.parsedFile.set(mockParsed);
        component.columnMappings.set([{ fileHeader: 'Title', targetField: 'title', isCustomField: false }]);
        component.validationSummary.set({ validCount: 1, errorCount: 0, rowResults: [{valid: true, errors: {}}] });
        
        mockBulkImportService.buildContentItem.mockReturnValue({ title: 'A', status: 'draft' });
        
        component.importContent('draft');
        
        expect(component.isImporting()).toBe(true);
        expect(mockDraftContentsStore.addBatch).toHaveBeenCalled();
        
        expect(mockSnackBar.open).toHaveBeenCalledWith(expect.stringContaining('Successfully imported'), expect.any(String), expect.any(Object));
        expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should import and publish', () => {
        // Setup valid state
        component.currentStep.set(3);
        const mockParsed: ParsedFile = { headers: ['Title'], rows: [{'Title': 'A'}], totalRows: 1 };
        component.parsedFile.set(mockParsed);
        component.columnMappings.set([{ fileHeader: 'Title', targetField: 'title', isCustomField: false }]);
        component.validationSummary.set({ validCount: 1, errorCount: 0, rowResults: [{valid: true, errors: {}}] });
        
        mockBulkImportService.buildContentItem.mockReturnValue({ title: 'A', status: 'publish' });
        
        // Mock confirm
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        
        component.importContent('publish');
        
        // Should verify that buildContentItem was called with 'publish'
        expect(mockBulkImportService.buildContentItem).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'publish');
    });

    it('should download template', () => {
        component.downloadTemplate();
        expect(mockBulkImportService.downloadSampleTemplate).toHaveBeenCalled();
    });

    describe('preview pagination', () => {
        beforeEach(() => {
            const rows = Array.from({ length: 60 }, (_, i) => ({ Title: `Row ${i}` }));
            const mockParsed: ParsedFile = { headers: ['Title'], rows, totalRows: 60 };
            component.parsedFile.set(mockParsed);
        });

        it('should slice rows correctly', () => {
            const page0 = component.getPage(0, 50);
            expect(page0.length).toBe(50);
            expect(page0[0]['Title']).toBe('Row 0');

            const page1 = component.getPage(1, 50);
            expect(page1.length).toBe(10);
            expect(page1[0]['Title']).toBe('Row 50');
        });

        it('should change page', () => {
            component.previewPage.set(1);
            expect(component.previewPage()).toBe(1);
        });
    });
    
    describe('error helpers', () => {
         it('should return empty string if no error', () => {
             component.validationSummary.set({ 
                 validCount: 1, 
                 errorCount: 0, 
                 rowResults: [{ valid: true, errors: {} }] 
             });
             expect(component.getErrorsForRow(0)).toBe('');
             expect(component.hasErrors(0)).toBe(false);
         });

         it('should return errors string if error exists', () => {
             component.validationSummary.set({ 
                 validCount: 0, 
                 errorCount: 1, 
                 rowResults: [{ valid: false, errors: { title: 'Required' } }] 
             });
             expect(component.getErrorsForRow(0)).toBe('Required');
             expect(component.hasErrors(0)).toBe(true);
         });

         it('should handle out of bounds or undefined gracefully', () => {
             component.validationSummary.set(null);
             expect(component.getErrorsForRow(0)).toBe('');
             // If validationSummary is null (e.g. before analysis), we consider it an error state or unsafe
             // implementation: !this.validationSummary()?.rowResults?.[rowIndex]?.valid
             // !undefined is true.
             expect(component.hasErrors(0)).toBe(true); 
         });
    });

});
