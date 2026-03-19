
import { TestBed } from '@angular/core/testing';
import { BulkImportService, ColumnMapping, ParsedFile } from './bulk-import.service';
import { ContentTypeField } from '../content-types/content-types.model';
import * as XLSX from 'xlsx';

describe('BulkImportService', () => {
    let service: BulkImportService;

    // Mock xlsx
    vi.mock('xlsx', () => ({
        utils: {
            book_new: vi.fn(() => ({})),
            aoa_to_sheet: vi.fn(() => ({})),
            book_append_sheet: vi.fn()
        },
        writeFile: vi.fn(),
        read: vi.fn()
    }));

    const mockCustomFields: ContentTypeField[] = [
        { key: 'author_name', label: 'Author Name', type: 'text', required: true, order: 1 },
        { key: 'publish_year', label: 'Publish Year', type: 'number', required: false, order: 2 },
        { key: 'is_verified', label: 'Is Verified', type: 'boolean', required: false, order: 3 }
    ];

    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(BulkImportService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    // Note: Testing parseFile with actual File object is tricky in Jest environment without polyfills.
    // We will trust XLSX library works and focus on logic that uses the parsed data.

    describe('autoMapColumns', () => {
        it('should map standard fields correctly', () => {
            const headers = ['Title', 'summary', 'URL Slug', 'Tags'];
            const mapping = service.autoMapColumns(headers, []);

            expect(mapping[0].targetField).toBe('title');
            expect(mapping[1].targetField).toBe('summary');
            expect(mapping[2].targetField).toBe('urlSlug');
            expect(mapping[3].targetField).toBe('tags');
        });

        it('should map custom fields by key or label', () => {
            const headers = ['author_name', 'Publish Year', 'Unknown Col'];
            const mapping = service.autoMapColumns(headers, mockCustomFields);

            expect(mapping[0].targetField).toBe('author_name');
            expect(mapping[0].isCustomField).toBe(true);
            
            expect(mapping[1].targetField).toBe('publish_year'); // Matched by label 'Publish Year'
            expect(mapping[1].isCustomField).toBe(true);
            
            expect(mapping[2].targetField).toBe(''); // Unmapped
        });
    });

    describe('validateRow', () => {
        const mapping: ColumnMapping[] = [
            { fileHeader: 'Title', targetField: 'title', isCustomField: false },
            { fileHeader: 'Author', targetField: 'author_name', isCustomField: true },
            { fileHeader: 'Year', targetField: 'publish_year', isCustomField: true }
        ];

        it('should pass valid row', () => {
            const row = { 'Title': 'My Title', 'Author': 'John', 'Year': 2023 };
            const result = service.validateRow(row, mapping, mockCustomFields);
            expect(result.valid).toBe(true);
        });

        it('should fail if required title is missing', () => {
            const row = { 'Title': '', 'Author': 'John', 'Year': 2023 };
            const result = service.validateRow(row, mapping, mockCustomFields);
            expect(result.valid).toBe(false);
            expect(result.errors['title']).toBeDefined();
        });

        it('should fail if required custom field is missing', () => {
            const row = { 'Title': 'My Title', 'Author': '', 'Year': 2023 };
            const result = service.validateRow(row, mapping, mockCustomFields);
            expect(result.valid).toBe(false);
            expect(result.errors['author_name']).toBeDefined();
        });

        it('should fail invalid number type', () => {
            const row = { 'Title': 'My Title', 'Author': 'John', 'Year': 'Not a number' };
            const result = service.validateRow(row, mapping, mockCustomFields);
            expect(result.valid).toBe(false);
            expect(result.errors['publish_year']).toBeDefined();
        });
    });

    describe('buildContentItem', () => {
        const mapping: ColumnMapping[] = [
            { fileHeader: 'Title', targetField: 'title', isCustomField: false },
            { fileHeader: 'Featured', targetField: 'isFeatured', isCustomField: false },
            { fileHeader: 'Tags', targetField: 'tags', isCustomField: false },
            { fileHeader: 'Author', targetField: 'author_name', isCustomField: true }
        ];

        it('should build content item processing values', () => {
            const row = { 
                'Title': 'My Content', 
                'Featured': 'yes', 
                'Tags': 'news, update', 
                'Author': 'Jane Doe' 
            };
            
            const item = service.buildContentItem(row, mapping, 'articles', 'draft');
            
            expect(item.title).toBe('My Content');
            expect(item.urlSlug).toBe('my-content');
            expect(item.isFeatured).toBe(true);
            expect(item.tags).toEqual(['news', 'update']);
            expect(item.customFields['author_name']).toBe('Jane Doe');
            expect(item.status).toBe('draft');
            expect(item.publishedStatus).toBe(false);
        });

        it('should set publish status if imported as publish', () => {
            const row = { 'Title': 'My Content' };
            const item = service.buildContentItem(row, mapping, 'articles', 'publish');
            
            expect(item.status).toBe('publish');
            expect(item.publishedStatus).toBe(true);
            expect(item.publishedOn).toBeTruthy();
        });
        
        it('should deduplicate logic (not implemented here but slug creation)', () => {
             const row = { 'Title': 'My Content' };
             const item = service.buildContentItem(row, mapping, 'articles');
             expect(item.urlSlug).toBe('my-content');
        });
    });
    
    describe('suggestFieldType', () => {
        it('should suggest number', () => {
            expect(service.suggestFieldType([1, '2', 3.5])).toBe('number');
        });
        
        it('should suggest boolean', () => {
            expect(service.suggestFieldType(['true', 'FALSE', 'yes', '0'])).toBe('boolean');
        });
        
        it('should suggest date', () => {
            expect(service.suggestFieldType(['2023-01-01', '2023/12/31'])).toBe('date');
        });
        
        it('should default to text', () => {
            expect(service.suggestFieldType(['foo', 123])).toBe('text');
        });
    });

    describe('downloadSampleTemplate', () => {
        it('should create and download excel file', () => {
            const mockContentType = {
                slug: 'articles',
                fields: [
                    { label: 'Custom Field', type: 'text' }
                ]
            };
            
            service.downloadSampleTemplate(mockContentType);

            expect(XLSX.utils.book_new).toHaveBeenCalled();
            expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalled();
            expect(XLSX.utils.book_append_sheet).toHaveBeenCalled();
            expect(XLSX.writeFile).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('import_template_articles'));
        });
    });
});
