import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { roleGuard } from '../../../../guards/role.guard';
import { FileImportProgress, UploadResult } from '../data-constants';
import { FileWithPath, ImportFilesService } from './import-files.service';

export const routeMeta: RouteMeta = {
    title: 'Import Files | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatCheckboxModule,
        MatIconModule,
        MatProgressBarModule,
        MatRadioModule, TranslocoPipe],
    templateUrl: './import-files.page.html',
    styleUrls: ['./import-files.page.scss'],
})
export default class ImportFilesPageComponent extends BaseComponent {
    private importFilesService = inject(ImportFilesService);

    mode = signal<'upload' | 'manifest'>('upload');
    selectedFiles = signal<File[]>([]);
    targetPrefix = signal('mediaImages/');
    updateMediaCollection = signal(true);

    // Manifest mode
    manifestFile = signal<File | null>(null);
    manifestData = signal<Record<string, any> | null>(null);
    /**
     * Number of entries in the loaded manifest, 0 when none is loaded.
     * Templates resolve names against the component, so `Object.keys(...)` cannot
     * be called inline — the global is not in template scope.
     */
    manifestEntryCount = computed(() => Object.keys(this.manifestData() ?? {}).length);

    /**
     * How many entries the uploaded manifest holds.
     *
     * `Object` is not in scope in an Angular template — the template read
     * `{{ Object.keys(...) }}`, which the compiler rejects under
     * strictTemplates. Counting here is what the template meant to say.
     */

    // Upload state
    isUploading = signal(false);
    uploadProgress = signal<FileImportProgress | null>(null);
    uploadResults = signal<UploadResult[] | null>(null);

    get totalSize(): number {
        return this.selectedFiles().reduce((sum, f) => sum + f.size, 0);
    }

    get successCount(): number {
        return this.uploadResults()?.filter((r) => r.success).length ?? 0;
    }

    get failCount(): number {
        return this.uploadResults()?.filter((r) => !r.success).length ?? 0;
    }

    onFilesSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files) {
            this.selectedFiles.set(Array.from(input.files));
        }
    }

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
    }

    onDrop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();

        if (event.dataTransfer?.files) {
            this.selectedFiles.set(Array.from(event.dataTransfer.files));
        }
    }

    async onManifestSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        this.manifestFile.set(file);

        try {
            const text = await file.text();
            this.manifestData.set(JSON.parse(text));
        } catch {
            this.notify.error('admin.data.import_files.invalid_manifest');
            this.manifestFile.set(null);
            this.manifestData.set(null);
        }
    }

    removeFile(index: number): void {
        this.selectedFiles.update((files) => files.filter((_, i) => i !== index));
    }

    async startUpload(): Promise<void> {
        if (this.mode() === 'manifest') {
            await this.uploadFromManifest();
            return;
        }

        const files = this.selectedFiles();
        if (files.length === 0) return;

        const prefix = this.targetPrefix();
        const filesToUpload: FileWithPath[] = files.map((f) => ({
            file: f,
            storagePath: `${prefix}${f.name}`,
        }));

        this.isUploading.set(true);
        this.uploadResults.set(null);

        try {
            const results = await this.importFilesService.uploadFiles(filesToUpload, (progress) => {
                this.uploadProgress.set(progress);
            });

            this.uploadResults.set(results);

            if (this.updateMediaCollection()) {
                await this.importFilesService.updateMediaMetadata(results);
            }

            const successCount = results.filter((r) => r.success).length;
            const failCount = results.filter((r) => !r.success).length;

            this.toastService.openCustomSnackbar(
                `Uploaded ${successCount} files. ${failCount} failed.`,
                failCount > 0 ? 'warning' : 'success',
                failCount > 0 ? 'warning' : 'check_circle',
            );
        } catch (error: any) {
            this.notify.error('admin.data.import_files.upload_failed', { error: error.message || this.t('common.unknown_error') });
        } finally {
            this.isUploading.set(false);
        }
    }

    private async uploadFromManifest(): Promise<void> {
        const manifest = this.manifestData();
        const files = this.selectedFiles();
        if (!manifest || files.length === 0) return;

        this.isUploading.set(true);
        this.uploadResults.set(null);

        try {
            const results = await this.importFilesService.importFromManifest(
                manifest,
                files,
                (progress) => {
                    this.uploadProgress.set(progress);
                },
            );

            this.uploadResults.set(results);

            if (this.updateMediaCollection()) {
                await this.importFilesService.updateMediaMetadata(results);
            }

            const successCount = results.filter((r) => r.success).length;
            this.toastService.openCustomSnackbar(`Restored ${successCount} files from manifest.`, 'success', 'check_circle');
        } catch (error: any) {
            this.notify.error('admin.data.import_files.restore_failed', { error: error.message || this.t('common.unknown_error') });
        } finally {
            this.isUploading.set(false);
        }
    }

    resetUpload(): void {
        this.selectedFiles.set([]);
        this.manifestFile.set(null);
        this.manifestData.set(null);
        this.uploadProgress.set(null);
        this.uploadResults.set(null);
    }

    formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}
