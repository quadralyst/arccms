
import { Injectable } from '@angular/core';
import { read, utils, writeFile } from 'xlsx';
import { ContentTypeField, ContentTypeFieldType } from '../content-types/content-types.model';
import { DraftContentsData } from '../draft-content-store/draft-contents.model';
import { isRepeaterType } from '../../../../../shared/models/repeater.model';

export interface ParsedFile {
    headers: string[];
    rows: Record<string, unknown>[];
    totalRows: number;
}

export interface ColumnMapping {
    fileHeader: string;
    targetField: string; // 'title', 'summary', or custom field key
    isCustomField: boolean;
}

export interface RowValidationResult {
    valid: boolean;
    errors: Record<string, string>; // cell errors by field key
}

export interface ImportValidationSummary {
    validCount: number;
    errorCount: number;
    rowResults: RowValidationResult[];
}

@Injectable({
    providedIn: 'root'
})
export class BulkImportService {

    /**
     * Parse XLSX or CSV file
     */
    async parseFile(file: File): Promise<ParsedFile> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target?.result as ArrayBuffer);
                    const workbook = read(data, { type: 'array' });

                    // Get first sheet
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];

                    // Convert to JSON
                    const jsonData = utils.sheet_to_json<Record<string, unknown>>(worksheet, {
                        raw: false, // Parse everything as strings initially
                        defval: '' // Default value for empty cells
                    });

                    if (jsonData.length === 0) {
                        resolve({ headers: [], rows: [], totalRows: 0 });
                        return;
                    }

                    // Extract headers from first row keys
                    const headers = Object.keys(jsonData[0]);

                    resolve({
                        headers,
                        rows: jsonData,
                        totalRows: jsonData.length
                    });
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = (error) => reject(error);
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Auto-map columns to fields based on name similarity
     */
    autoMapColumns(headers: string[], customFields: ContentTypeField[]): ColumnMapping[] {
        const standardFields = [
            { key: 'title', label: 'Title' },
            { key: 'content', label: 'Content' },
            { key: 'summary', label: 'Summary' },
            { key: 'urlSlug', label: 'URL Slug' },
            { key: 'tags', label: 'Tags' },
            { key: 'coverImage', label: 'Cover Image URL' },
            { key: 'seoTitle', label: 'SEO Title' },
            { key: 'metaDescription', label: 'Meta Description' },
            { key: 'canonicalUrl', label: 'Canonical URL' },
            { key: 'isFeatured', label: 'Featured' }
        ];

        return headers.map(header => {
            const normalizedHeader = header.toLowerCase().trim().replace(/_/g, ' ');

            // 1. Check standard fields
            const standardMatch = standardFields.find(f =>
                f.key.toLowerCase() === normalizedHeader ||
                f.label.toLowerCase() === normalizedHeader
            );

            if (standardMatch) {
                return {
                    fileHeader: header,
                    targetField: standardMatch.key,
                    isCustomField: false
                };
            }

            // 2. Check custom fields (by label or key)
            // Repeating fields are skipped: a column of text cannot become
            // rows of sub-fields, and auto-mapping one would import garbage.
            const customMatch = customFields.find(f =>
                !isRepeaterType(f.type) && (
                    f.key.toLowerCase() === normalizedHeader ||
                    f.label.toLowerCase() === normalizedHeader
                )
            );

            if (customMatch) {
                return {
                    fileHeader: header,
                    targetField: customMatch.key,
                    isCustomField: true
                };
            }

            // Unmapped
            return {
                fileHeader: header,
                targetField: '',
                isCustomField: false
            };
        });
    }

    /**
     * Validate a single row based on mapping and field definitions
     */
    validateRow(
        row: Record<string, unknown>,
        mapping: ColumnMapping[],
        customFields: ContentTypeField[]
    ): RowValidationResult {
        const errors: Record<string, string> = {};

        // 1. Mandatory Title
        const titleMapping = mapping.find(m => m.targetField === 'title');
        const titleVal = titleMapping ? row[titleMapping.fileHeader] : null;
        if (!titleVal || String(titleVal).trim() === '') {
            errors['title'] = 'Title is required';
        }

        // 2. Required Custom Fields
        customFields.filter(f => f.required).forEach(field => {
            const fieldMapping = mapping.find(m => m.targetField === field.key);
            const val = fieldMapping ? row[fieldMapping.fileHeader] : null;

            if (val === undefined || val === null || String(val).trim() === '') {
                errors[field.key] = `${field.label} is required`;
            }
        });

        // 3. Type Validation (Basic)
        mapping.filter(m => m.isCustomField && m.targetField).forEach(m => {
            const fieldDef = customFields.find(f => f.key === m.targetField);
            const rawVal = row[m.fileHeader];

            if (fieldDef && rawVal !== undefined && rawVal !== '' && rawVal !== null) {
                if (fieldDef.type === 'number') {
                    if (isNaN(Number(rawVal))) {
                        errors[fieldDef.key] = 'Invalid number';
                    }
                } else if (fieldDef.type === 'date') {
                    if (isNaN(Date.parse(String(rawVal)))) {
                        errors[fieldDef.key] = 'Invalid date';
                    }
                } else if (fieldDef.type === 'boolean') {
                    const norm = String(rawVal).toLowerCase();
                    if (!['true', 'false', 'yes', 'no', '1', '0'].includes(norm)) {
                        errors[fieldDef.key] = 'Invalid boolean (use true/false, yes/no, 1/0)';
                    }
                }
            }
        });

        return {
            valid: Object.keys(errors).length === 0,
            errors
        };
    }

    /**
     * Transform a row into a draft content object
     */
    buildContentItem(
        row: Record<string, unknown>,
        mapping: ColumnMapping[],
        contentTypeSlug: string,
        importAs: 'draft' | 'publish' = 'draft'
    ): DraftContentsData {
        const item: any = {
            type: contentTypeSlug,
            status: importAs,
            publishedStatus: importAs === 'publish',
            publishedOn: importAs === 'publish' ? new Date() : null,
            categoryIdArr: [],
            categoryNameArr: [],
            tags: [],
            customFields: {}
        };

        mapping.forEach(m => {
            if (!m.targetField) return;

            const rawVal = row[m.fileHeader];
            
            if (m.isCustomField) {
                // Handle custom fields
                item.customFields[m.targetField] = this.parseValue(rawVal);
            } else {
                // Handle standard fields
                if (m.targetField === 'tags') {
                    item.tags = this.parseTags(String(rawVal || ''));
                } else if (m.targetField === 'isFeatured') {
                    item.isFeatured = this.parseBoolean(rawVal);
                } else {
                    item[m.targetField] = rawVal;
                }
            }
        });

        // Auto-generate slug if missing
        if (!item.urlSlug && item.title) {
            item.urlSlug = this.slugify(item.title);
        } else if (item.urlSlug) {
            item.urlSlug = this.slugify(item.urlSlug);
        }

        return item as DraftContentsData;
    }

    private parseValue(val: unknown): unknown {
        if (val === undefined || val === null) return null;
        const str = String(val).trim();
        if (str === '') return null;
        return str;
    }

    private parseBoolean(val: unknown): boolean {
        const str = String(val).toLowerCase().trim();
        return ['true', 'yes', '1'].includes(str);
    }

    private parseTags(val: string): string[] {
        if (!val) return [];
        return val.split(',').map(t => t.trim()).filter(t => t.length > 0);
    }

    private slugify(text: string): string {
        return text
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')     // Replace spaces with -
            .replace(/[^\w\-]+/g, '') // Remove all non-word chars
            .replace(/\-\-+/g, '-');  // Replace multiple - with single -
    }

    /**
     * Get unmapped headers
     */
    getUnmappedHeaders(headers: string[], mapping: ColumnMapping[]): string[] {
        return headers.filter(h => {
           const map = mapping.find(m => m.fileHeader === h);
           return !map || !map.targetField;
        });
    }

    /**
     * Suggest field type based on values
     */
    suggestFieldType(values: unknown[]): ContentTypeFieldType {
        const validValues = values.filter(v => v !== undefined && v !== null && String(v).trim() !== '');

        if (validValues.length === 0) return 'text';

        const allNumbers = validValues.every(v => !isNaN(Number(v)));
        if (allNumbers) return 'number';

        const allBooleans = validValues.every(v => {
            const s = String(v).toLowerCase();
            return ['true', 'false', 'yes', 'no', '1', '0'].includes(s);
        });
        if (allBooleans) return 'boolean';

        const allDates = validValues.every(v => !isNaN(Date.parse(String(v))));
        if (allDates) return 'date';

        if (validValues.some(v => String(v).length > 255)) return 'richtext';

        return 'text';
    }
    /**
     * Download a sample Excel template for the given content type
     */
    downloadSampleTemplate(contentType: any): void {
        // Defines headers
        const headers = [
            'Title',
            'Content',
            'Summary',
            'URL Slug',
            'Tags',
            'Featured',
            'Cover Image URL',
            ...contentType.fields.map((f: any) => f.label)
        ];

        // Define a sample row with hints
        const sampleRow = [
            'Example Title',
            '<p>HTML Content</p>',
            'Short summary',
            'example-title',
            'news, update',
            'FALSE',
            'https://example.com/image.jpg',
            ...contentType.fields.map((f: any) => {
                switch (f.type) {
                    case 'number': return 123;
                    case 'boolean': return 'TRUE';
                    case 'date': return '2023-12-31';
                    case 'richtext': return '<p>Text</p>';
                    default: return 'Sample Text';
                }
            })
        ];

        // Create workbook and worksheet
        const wb = utils.book_new();
        const ws = utils.aoa_to_sheet([headers, sampleRow]);

        // Adjust column widths (optional but nice)
        const wscols = headers.map(() => ({ wch: 20 }));
        ws['!cols'] = wscols;

        utils.book_append_sheet(wb, ws, 'Template');

        // Generate file name
        const fileName = `import_template_${contentType.slug}_${new Date().toISOString().split('T')[0]}.xlsx`;

        // Download
        writeFile(wb, fileName);
    }
}
