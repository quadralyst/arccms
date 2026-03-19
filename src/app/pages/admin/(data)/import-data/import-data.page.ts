import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { FormsModule } from '@angular/forms';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { roleGuard } from '../../../../guards/role.guard';
import {
    COLLECTION_GROUP_DEFS,
    CollectionGroupId,
    ExportFormat,
    getCollectionGroupId,
    ImportOptions,
    ImportProgress,
    ImportResult,
    ImportValidationResult,
} from '../data-constants';
import { ImportDataService } from './import-data.service';

export const routeMeta: RouteMeta = {
    title: 'Import Data | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

export interface ImportCollectionGroup {
    id: CollectionGroupId | 'unknown';
    label: string;
    icon: string;
    items: { path: string; documentCount: number; isKnown: boolean }[];
}

@Component({
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatCheckboxModule,
        MatIconModule,
        MatProgressBarModule,
        MatRadioModule,
    ],
    templateUrl: './import-data.page.html',
    styleUrls: ['./import-data.page.scss'],
})
export default class ImportDataPageComponent extends BaseComponent {
    private importService = inject(ImportDataService);

    currentStep = signal<1 | 2 | 3>(1);
    selectedFile = signal<File | null>(null);
    parsedData = signal<ExportFormat | null>(null);
    validationResult = signal<ImportValidationResult | null>(null);
    parseError = signal<string | null>(null);

    // Step 2 state
    selectedCollections = signal<Set<string>>(new Set());
    conflictMode = signal<'overwrite' | 'skip' | 'merge'>('skip');

    // Step 3 state
    isImporting = signal(false);
    importProgress = signal<ImportProgress | null>(null);
    importResult = signal<ImportResult | null>(null);

    get selectedCount(): number {
        return this.selectedCollections().size;
    }

    // -----------------------------------------------------------------------
    // Grouped import collections for Step 2
    // -----------------------------------------------------------------------

    getGroupedImportCollections(): ImportCollectionGroup[] {
        const summary = this.validationResult()?.collectionSummary;
        if (!summary) return [];

        // Bucket items by group
        const buckets = new Map<string, { path: string; documentCount: number; isKnown: boolean }[]>();
        for (const item of summary) {
            const groupId = getCollectionGroupId(item.path);
            if (!buckets.has(groupId)) {
                buckets.set(groupId, []);
            }
            buckets.get(groupId)!.push(item);
        }

        // Build ordered groups
        const groups: ImportCollectionGroup[] = [];

        // Known groups first, in definition order
        for (const def of COLLECTION_GROUP_DEFS) {
            const items = buckets.get(def.id);
            if (items && items.length > 0) {
                groups.push({
                    id: def.id,
                    label: def.label,
                    icon: def.icon,
                    items,
                });
            }
        }

        // Unknown group last
        const unknownItems = buckets.get('unknown');
        if (unknownItems && unknownItems.length > 0) {
            groups.push({
                id: 'unknown',
                label: 'Other Collections',
                icon: 'fa-solid fa-question-circle',
                items: unknownItems,
            });
        }

        return groups;
    }

    toggleImportGroup(group: ImportCollectionGroup, checked: boolean): void {
        this.selectedCollections.update((set) => {
            const newSet = new Set(set);
            for (const item of group.items) {
                if (checked) {
                    newSet.add(item.path);
                } else {
                    newSet.delete(item.path);
                }
            }
            return newSet;
        });
    }

    isImportGroupFullySelected(group: ImportCollectionGroup): boolean {
        const sel = this.selectedCollections();
        return group.items.length > 0 && group.items.every((item) => sel.has(item.path));
    }

    isImportGroupPartiallySelected(group: ImportCollectionGroup): boolean {
        const sel = this.selectedCollections();
        const anySelected = group.items.some((item) => sel.has(item.path));
        return anySelected && !this.isImportGroupFullySelected(group);
    }

    async onFileSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        this.selectedFile.set(file);
        this.parseError.set(null);

        try {
            const data = await this.importService.parseExportFile(file);
            this.parsedData.set(data);

            const validation = this.importService.validateExportData(data);
            this.validationResult.set(validation);

            if (validation.isValid) {
                // Auto-select all known collections
                const paths = validation.collectionSummary.map((c) => c.path);
                this.selectedCollections.set(new Set(paths));
                this.currentStep.set(2);
            } else {
                this.parseError.set(validation.errors.join('; '));
            }
        } catch (error: any) {
            this.parseError.set(error.message || 'Failed to parse file');
            this.parsedData.set(null);
            this.validationResult.set(null);
        }
    }

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
    }

    async onDrop(event: DragEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();

        const file = event.dataTransfer?.files?.[0];
        if (!file) return;

        // Simulate file input event
        this.selectedFile.set(file);
        this.parseError.set(null);

        try {
            const data = await this.importService.parseExportFile(file);
            this.parsedData.set(data);

            const validation = this.importService.validateExportData(data);
            this.validationResult.set(validation);

            if (validation.isValid) {
                const paths = validation.collectionSummary.map((c) => c.path);
                this.selectedCollections.set(new Set(paths));
                this.currentStep.set(2);
            } else {
                this.parseError.set(validation.errors.join('; '));
            }
        } catch (error: any) {
            this.parseError.set(error.message || 'Failed to parse file');
        }
    }

    toggleCollection(path: string): void {
        this.selectedCollections.update((set) => {
            const newSet = new Set(set);
            if (newSet.has(path)) {
                newSet.delete(path);
            } else {
                newSet.add(path);
            }
            return newSet;
        });
    }

    toggleAllCollections(checked: boolean): void {
        if (checked) {
            const paths = this.validationResult()?.collectionSummary.map((c) => c.path) || [];
            this.selectedCollections.set(new Set(paths));
        } else {
            this.selectedCollections.set(new Set());
        }
    }

    goBack(): void {
        const step = this.currentStep();
        if (step === 2) {
            this.currentStep.set(1);
        } else if (step === 3) {
            this.currentStep.set(2);
        }
    }

    async startImport(): Promise<void> {
        const data = this.parsedData();
        if (!data) return;

        const selected = Array.from(this.selectedCollections());
        if (selected.length === 0) return;

        const options: ImportOptions = {
            overwriteExisting: this.conflictMode() === 'overwrite',
            skipExisting: this.conflictMode() === 'skip',
        };

        this.currentStep.set(3);
        this.isImporting.set(true);
        this.importResult.set(null);

        try {
            const result = await this.importService.importCollections(
                data,
                selected,
                options,
                (progress) => {
                    this.importProgress.set(progress);
                },
            );

            this.importResult.set(result);
            this.toastService.openCustomSnackbar(
                `Imported ${result.totalImported} documents. ${result.totalSkipped} skipped. ${result.totalErrored} errors.`,
                result.totalErrored > 0 ? 'warning' : 'success',
                result.totalErrored > 0 ? 'warning' : 'check_circle',
            );
        } catch (error: any) {
            this.toastService.openCustomSnackbar(
                'Import failed: ' + (error.message || 'Unknown error'),
                'error',
                'error',
            );
        } finally {
            this.isImporting.set(false);
        }
    }

    resetImport(): void {
        this.currentStep.set(1);
        this.selectedFile.set(null);
        this.parsedData.set(null);
        this.validationResult.set(null);
        this.parseError.set(null);
        this.selectedCollections.set(new Set());
        this.importProgress.set(null);
        this.importResult.set(null);
    }
}
