import { DatePipe } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ConfirmationPopupComponent } from '../../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { escapeHtml } from '../../../../../shared/utils/escape-html';
import { formatBytes, MEDIA_FILE_TYPE_ICONS, MEDIA_FILE_TYPE_LABELS } from '../../../../../shared/utils/media-files';
import { DomSanitizer } from '@angular/platform-browser';
import { MediaDetailsChange, MediaDetailsComponent } from '../media-details/media-details.component';
import { IMediaFile } from '../media-files.model';
import { MediaFilesService } from '../media-files.service';

/**
 * The side panel of a file in the Files tab (docs/features/media.html, Files):
 * its first page or icon, title and notes, type, size, pages, and Copy link,
 * Open, Delete and, for a PDF, Take an image.
 */
@Component({
    selector: 'arc-media-file-panel',
    standalone: true,
    imports: [TranslocoPipe, DatePipe, MediaDetailsComponent],
    templateUrl: './media-file-panel.component.html',
})
export class MediaFilePanelComponent {
    private files = inject(MediaFilesService);
    private notify = inject(NotifyService);
    private dialog = inject(MatDialog);
    private i18n = inject(TranslocoService);
    private sanitizer = inject(DomSanitizer);

    readonly file = input.required<IMediaFile>();
    /** Take an image is offered only where it can be used (not while a crop saves). */
    readonly canTakeImage = input(true);
    /** Delete and editing are for the Media page and the picker alike; off while busy. */
    readonly busy = input(false);

    readonly changed = output<IMediaFile>();
    readonly deleted = output<string>();
    readonly takeImage = output<IMediaFile>();

    readonly icons = MEDIA_FILE_TYPE_ICONS;
    readonly typeLabels = MEDIA_FILE_TYPE_LABELS;
    readonly deleting = signal(false);

    size(file: IMediaFile): string {
        return formatBytes(file.bytes);
    }

    async save(change: MediaDetailsChange): Promise<void> {
        const file = this.file();
        try {
            await this.files.saveDetails(file, change);
            this.changed.emit({ ...file, ...change } as IMediaFile);
        } catch (error) {
            console.error('Failed to save file details:', error);
            this.notify.error('admin.media.details.save_failed');
        }
    }

    async copyLink(): Promise<void> {
        try {
            await navigator.clipboard.writeText(this.file().downloadURL);
            this.notify.success('admin.media.files.link_copied');
        } catch {
            this.notify.error('admin.media.files.link_copy_failed');
        }
    }

    open(): void {
        window.open(this.file().downloadURL, '_blank', 'noopener');
    }

    confirmDelete(): void {
        const file = this.file();
        const message = this.i18n.translate('admin.media.files.delete_confirm', { title: escapeHtml(file.title) });
        const ref = this.dialog.open(ConfirmationPopupComponent, {
            width: '380px',
            data: {
                dialogType: 'Delete',
                dialogMessage: this.sanitizer.bypassSecurityTrustHtml(message),
                btnText: this.i18n.translate('common.actions.delete'),
                panelType: 'warn',
            },
        });
        ref.afterClosed().subscribe((confirmed) => {
            if (confirmed) void this.delete(file);
        });
    }

    private async delete(file: IMediaFile): Promise<void> {
        this.deleting.set(true);
        try {
            await this.files.deleteFile(file.id);
            this.deleted.emit(file.id);
        } catch (error) {
            console.error('Failed to delete file:', error);
            this.notify.error('admin.media.files.delete_failed');
        } finally {
            this.deleting.set(false);
        }
    }
}
