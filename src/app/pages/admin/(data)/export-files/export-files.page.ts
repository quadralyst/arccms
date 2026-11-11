import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { Component, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { roleGuard } from '../../../../guards/role.guard';
import { FileExportProgress, MediaDocInfo } from '../data-constants';
import { ExportFilesService } from './export-files.service';

export const routeMeta: RouteMeta = {
    title: 'Export files',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

// ---------------------------------------------------------------------------
// View-model
// ---------------------------------------------------------------------------

export interface SelectableMedia extends MediaDocInfo {
    selected: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatCheckboxModule,
        MatIconModule,
        MatProgressBarModule, TranslocoPipe],
    templateUrl: './export-files.page.html',
    styleUrls: ['./export-files.page.scss'],
})
export default class ExportFilesPageComponent extends BaseComponent implements OnInit {
    private exportFilesService = inject(ExportFilesService);

    mediaItems = signal<SelectableMedia[]>([]);
    isLoading = signal(true);
    isDownloading = signal(false);
    downloadProgress = signal<FileExportProgress | null>(null);
    loadError = signal<string | null>(null);

    // -----------------------------------------------------------------------
    // Computed helpers
    // -----------------------------------------------------------------------

    get selectedCount(): number {
        return this.mediaItems().filter((m) => m.selected).length;
    }

    get totalCount(): number {
        return this.mediaItems().length;
    }

    get allSelected(): boolean {
        const items = this.mediaItems();
        return items.length > 0 && items.every((m) => m.selected);
    }

    get someSelected(): boolean {
        return this.selectedCount > 0 && !this.allSelected;
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    ngOnInit(): void {
        this.loadMedia();
    }

    // -----------------------------------------------------------------------
    // Data loading
    // -----------------------------------------------------------------------

    async loadMedia(): Promise<void> {
        this.isLoading.set(true);
        this.loadError.set(null);

        try {
            const items = await this.exportFilesService.getMediaItems();
            this.mediaItems.set(items.map((m) => ({ ...m, selected: false })));
        } catch (error: any) {
            console.error('Loading the media list failed:', error);
            this.loadError.set(this.t('admin.data.export_files.load_failed'));
        } finally {
            this.isLoading.set(false);
        }
    }

    // -----------------------------------------------------------------------
    // Selection
    // -----------------------------------------------------------------------

    toggleAll(checked: boolean): void {
        this.mediaItems.update((items) =>
            items.map((m) => ({ ...m, selected: checked })),
        );
    }

    toggleItem(id: string): void {
        this.mediaItems.update((items) =>
            items.map((m) => (m.id === id ? { ...m, selected: !m.selected } : m)),
        );
    }

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------

    async downloadAsZip(): Promise<void> {
        const selected = this.mediaItems().filter((m) => m.selected);
        if (selected.length === 0) return;

        this.isDownloading.set(true);
        this.downloadProgress.set(null);

        try {
            const zipBlob = await this.exportFilesService.downloadAsZip(selected, (progress) => {
                this.downloadProgress.set(progress);
            });

            const timestamp = new Date().toISOString().split('T')[0];
            this.exportFilesService.triggerDownload(zipBlob, `arccms-media-${timestamp}.zip`);

            this.notify.success('admin.data.export_files.done', { count: selected.length });
        } catch (error: any) {
            console.error('Downloading the media failed:', error);
            this.notify.error('admin.data.export_files.failed');
        } finally {
            this.isDownloading.set(false);
            this.downloadProgress.set(null);
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    formatUploadDate(isoString: string): string {
        if (!isoString) return '';
        try {
            return new Date(isoString).toLocaleDateString(this.transloco.getActiveLang(), {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
            });
        } catch {
            return isoString;
        }
    }
}
