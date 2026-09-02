
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';

import { BulkImportService, ColumnMapping, ImportValidationSummary, ParsedFile } from './bulk-import.service';
import { ContentTypesStore } from '../content-types/content-types.store';
import { ContentTypeField } from '../content-types/content-types.model';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';
import { PublishQueueService } from '../publish-queue/publish-queue.service';
import { isRepeaterType } from '../../../../../shared/models/repeater.model';

@Component({
    selector: 'app-bulk-import-dialog',
    imports: [
        CommonModule,
        FormsModule,
        MatDialogModule,
        MatButtonModule,
        MatIconModule,
        MatSelectModule,
        MatInputModule,
        MatProgressBarModule,
        MatTableModule,
        MatTooltipModule,
        MatCheckboxModule,
        MatDividerModule
    ],
    templateUrl: './bulk-import-dialog.component.html',
    styleUrls: ['./bulk-import-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class BulkImportDialogComponent {
    private dialogRef = inject(MatDialogRef<BulkImportDialogComponent>);
    private data = inject(MAT_DIALOG_DATA); // { contentTypeSlug: string }
    private bulkImportService = inject(BulkImportService);
    private contentTypesStore = inject(ContentTypesStore);
    private draftContentsStore = inject(DraftContentsStore);
    private publishQueueService = inject(PublishQueueService);
    private snackBar = inject(MatSnackBar);

    // Steps: 1=File, 2=Mapping, 3=Preview, 4=Importing
    currentStep = signal<number>(1);
    
    // File State
    selectedFile = signal<File | null>(null);
    parsedFile = signal<ParsedFile | null>(null);
    
    // Mapping State
    columnMappings = signal<ColumnMapping[]>([]);
    
    // Validation State
    validationSummary = signal<ImportValidationSummary | null>(null);
    
    // Import State
    isImporting = signal<boolean>(false);
    
    // Preview pagination
    previewPage = signal<number>(0);
    
    // Expose Math for template
    readonly Math = Math;
    
    // Derived State
    contentType = computed(() => 
        this.contentTypesStore.items().find(ct => ct.slug === this.data.contentTypeSlug)
    );
    
    availableFields = computed(() => {
        const ct = this.contentType();
        if (!ct) return [];
        
        const standard = [
            { key: 'title', label: 'Title (Required)' },
            { key: 'content', label: 'Content' },
            { key: 'summary', label: 'Summary' },
            { key: 'urlSlug', label: 'URL Slug' },
            { key: 'tags', label: 'Tags' },
            { key: 'coverImage', label: 'Cover Image URL' },
            { key: 'isFeatured', label: 'Featured' }
        ];
        
        // Repeating fields hold rows of sub-fields; a single spreadsheet cell
        // cannot express one, so they are not offered as an import target.
        const custom = ct.fields
            .filter(f => !isRepeaterType(f.type))
            .map(f => ({
                key: f.key,
                label: `${f.label} (${f.type})` + (f.required ? ' *' : '')
            }));
        
        return [...standard, ...custom];
    });

    constructor() {
        // Ensure content types are loaded
        if (this.contentTypesStore.items().length === 0) {
            this.contentTypesStore.getAll();
        }
    }

    // -- Step 1: File Selection --
    
    onFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files?.length) {
            this.processFile(input.files[0]);
        }
    }
    
    onDrop(event: DragEvent) {
        event.preventDefault();
        if (event.dataTransfer?.files.length) {
            this.processFile(event.dataTransfer.files[0]);
        }
    }
    
    onDragOver(event: DragEvent) {
        event.preventDefault();
        // Add visual feedback class via template
    }

    async processFile(file: File) {
        this.selectedFile.set(file);
        this.previewPage.set(0);
        try {
            const result = await this.bulkImportService.parseFile(file);
            this.parsedFile.set(result);
            
            // Auto-map
            const ct = this.contentType();
            if (ct) {
                const mappings = this.bulkImportService.autoMapColumns(result.headers, ct.fields);
                this.columnMappings.set(mappings);
            }
            
            this.nextStep();
        } catch (error) {
            console.error('File parsing failed:', error);
            this.snackBar.open('Failed to parse file. Please check format.', 'Close', { duration: 3000 });
            this.selectedFile.set(null);
        }
    }

    downloadTemplate() {
        const ct = this.contentType();
        if (ct) {
            this.bulkImportService.downloadSampleTemplate(ct);
        }
    }

    // -- Step 2: Mapping --
    
    updateMapping(index: number, fieldKey: string) {
        const mappings = [...this.columnMappings()];
        const ct = this.contentType();
        if (!ct) return;

        // Prevent duplicate mappings: clear any other column using this field
        if (fieldKey) {
            mappings.forEach((m, i) => {
                if (i !== index && m.targetField === fieldKey) {
                    mappings[i] = { ...m, targetField: '', isCustomField: false };
                }
            });
        }

        // Check if custom field
        const isCustom = ct.fields.some(f => f.key === fieldKey);
        
        mappings[index] = {
            ...mappings[index],
            targetField: fieldKey,
            isCustomField: isCustom
        };
        this.columnMappings.set(mappings);
    }
    
    createCustomField(headerName: string) {
        const ct = this.contentType();
        if (!ct) return;

        // Suggest type based on first 50 rows
        const fileData = this.parsedFile();
        const sampleValues = fileData?.rows.slice(0, 50).map(r => r[headerName]) || [];
        const suggestedType = this.bulkImportService.suggestFieldType(sampleValues);
        
        const newField: ContentTypeField = {
            key: headerName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
            label: headerName,
            type: suggestedType,
            required: false,
            order: ct.fields.length + 1
        };
        
        const updatedFields = [...ct.fields, newField];
        
        // Save to store and subscribe to ensure it completes
        this.contentTypesStore.update(ct.id, { fields: updatedFields }).subscribe({
            next: () => {
                this.snackBar.open(`Created new field: ${newField.label} (${newField.type})`, 'Close', { duration: 2000 });
            },
            error: (err) => {
                console.error('Failed to create custom field:', err);
                this.snackBar.open('Failed to create custom field', 'Close', { duration: 3000 });
            }
        });
        
        // Auto-select the new field for this column
        const mappings = [...this.columnMappings()];
        const idx = mappings.findIndex(m => m.fileHeader === headerName);
        if (idx !== -1) {
            mappings[idx] = {
                ...mappings[idx],
                targetField: newField.key,
                isCustomField: true
            };
            this.columnMappings.set(mappings);
        }
    }

    validateAndPreview() {
        const file = this.parsedFile();
        const ct = this.contentType();
        if (!file || !ct) return;
        
        const summary = {
            validCount: 0,
            errorCount: 0,
            rowResults: []
        } as ImportValidationSummary;
        
        const results = file.rows.map(row => 
            this.bulkImportService.validateRow(row, this.columnMappings(), ct.fields)
        );
        
        summary.rowResults = results;
        summary.validCount = results.filter(r => r.valid).length;
        summary.errorCount = results.filter(r => !r.valid).length;
        
        this.validationSummary.set(summary);
        this.nextStep();
    }

    // -- Step 3: Importing --
    
    async importContent(importAs: 'draft' | 'publish') {
        const file = this.parsedFile();
        const ct = this.contentType();
        const summary = this.validationSummary();
        
        if (!file || !ct || !summary) return;
        
        if (importAs === 'publish' && !confirm('Are you sure you want to publish these items immediately?')) {
            return;
        }

        this.isImporting.set(true);
        
        // Filter valid rows
        const validRows = file.rows.filter((_, idx) => summary.rowResults[idx]?.valid);
        
        // Build generic content objects
        const itemsToImport = validRows.map(row => 
            this.bulkImportService.buildContentItem(
                row, 
                this.columnMappings(), 
                ct.slug, 
                importAs
            )
        );
        
        this.draftContentsStore.addBatch(itemsToImport, ct.slug).subscribe({
            next: (ids) => {
                // Enqueue publish for each imported item that was published
                if (importAs === 'publish' && ct.slug) {
                    ids.forEach((id: string) => {
                        this.publishQueueService.enqueue('publish', ct.slug, id);
                    });
                }
                this.snackBar.open(
                    `Successfully imported ${ids.length} items as ${importAs === 'publish' ? 'Published' : 'Drafts'}`,
                    'Close',
                    { duration: 4000 }
                );
                this.dialogRef.close(true);
            },
            error: (err) => {
                console.error('Import failed', err);
                this.snackBar.open('Import failed: ' + err.message, 'Close', { duration: 5000 });
                this.isImporting.set(false);
            }
        });
    }

    // -- Navigation --
    
    nextStep() {
        this.currentStep.update(s => s + 1);
    }
    
    prevStep() {
        this.currentStep.update(s => s - 1);
    }
    
    cancel() {
        this.dialogRef.close(false);
    }
    
    // Helpers for template
    getPage(page: number, pageSize: number) {
        const rows = this.parsedFile()?.rows || [];
        const start = page * pageSize;
        return rows.slice(start, start + pageSize);
    }
    
    getErrorsForRow(rowIndex: number): string {
        const res = this.validationSummary()?.rowResults?.[rowIndex];
        if (!res || res.valid) return '';
        return Object.values(res.errors).join(', ');
    }
    
    hasErrors(rowIndex: number): boolean {
        return !this.validationSummary()?.rowResults?.[rowIndex]?.valid;
    }
}
