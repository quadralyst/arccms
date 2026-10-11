import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { doc, Firestore, getDoc } from '@angular/fire/firestore';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { MediaManagerStore } from '../../../../app/pages/admin/(media)/media-manager.store';
import { DEFAULT_IMAGE_SIZE } from '../../../utils/image-sizes';
import { FileUploadService, MediaFileUploadError, MediaUploadSettings, uploadSettingsFromMisc } from '../../../services/file-upload.service';
import { NotifyService } from '../../../services/notify.service';
import { MediaFilesService } from '../../../../app/pages/admin/(media)/media-files.service';
import { formatBytes, MediaFileRef } from '../../../utils/media-files';

/**
 * Uploads an image dropped or pasted into the rich text editor the way the
 * media manager uploads one: the media settings from Settings → Misc, every
 * size, WebP when it is on, and a `media` document so the image shows in My
 * Uploads. The editor then gets the size its Insert image uses (M), never the
 * file's bytes as a data URL.
 */
@Injectable({ providedIn: 'root' })
export class EditorImageUploadService {
    private fileUpload = inject(FileUploadService);
    private mediaStore = inject(MediaManagerStore);
    private firestore = inject(Firestore);
    private injector = inject(Injector);
    private transloco = inject(TranslocoService);
    private notify = inject(NotifyService);
    private mediaFiles = inject(MediaFilesService);

    /**
     * Uploads `file` and resolves to the URL to put in the editor. Rejects,
     * with a message fit to show, when the file is the wrong type, too large
     * or the upload fails.
     */
    async upload(file: File, onProgress: (percent: number) => void): Promise<string> {
        const typeError = this.fileUpload.validateFileType(file);
        if (typeError) throw new Error(typeError);

        const uploaded = await this.fileUpload.uploadFile(file, await this.readSettings(), onProgress);

        // The image is stored whatever happens here, so it still goes in the
        // page; only its library entry is missing.
        try {
            await firstValueFrom(this.mediaStore.addBatch([uploaded]));
        } catch (error) {
            console.error('Failed to save media metadata:', error);
            this.notify.warning('admin.media.editor_library_failed');
        }

        return uploaded.variants?.[DEFAULT_IMAGE_SIZE]?.url ?? uploaded.downloadURL;
    }

    /**
     * Uploads a document dropped or pasted into the editor to the library's
     * Files (docs/features/media.html, Files) and resolves to the file the
     * card links to. Rejects, with a message fit to show, for a type or size
     * the library does not take.
     */
    async uploadDocument(file: File, onProgress: (percent: number) => void): Promise<MediaFileRef> {
        const uploaded = await this.fileUpload.uploadDocument(file, onProgress);
        try {
            const [id] = await firstValueFrom(this.mediaFiles.addBatch([uploaded]));
            if (uploaded.type === 'pdf' && id) this.mediaFiles.rememberBytes(id, file);
        } catch (error) {
            // The file is stored, so the card still works; only its library entry is missing.
            console.error('Failed to save file details:', error);
            this.notify.warning('admin.media.editor_file_library_failed');
        }
        const ref: MediaFileRef = { url: uploaded.downloadURL, title: uploaded.title, type: uploaded.type, bytes: uploaded.bytes };
        if (uploaded.pages) ref.pages = uploaded.pages;
        return ref;
    }

    /** A dropped file that is neither an image nor a document the library takes. */
    showUnsupported(file: File): void {
        this.notify.error('admin.media.files.error_type', { name: file.name });
    }

    /** What the placeholder says while `file` uploads. */
    uploadingLabel(file: File, percent: number): string {
        return this.transloco.translate('admin.media.editor_uploading', { name: file.name, percent: Math.round(percent) });
    }

    /**
     * Tells the admin why `file` was not added. A wrong type or a file too
     * large says so (FileUploadService's own words); a Storage or network
     * failure gets a plain sentence rather than a Firebase code.
     */
    showError(file: File, error: unknown): void {
        if (error instanceof MediaFileUploadError) {
            const name = file.name;
            if (error.problem === 'type') this.notify.error('admin.media.files.error_type', { name });
            else this.notify.error('admin.media.files.error_size', { name, size: formatBytes(error.bytes) });
            return;
        }
        const firebaseError = typeof (error as { code?: unknown })?.code === 'string';
        const reason = error instanceof Error && error.message && !firebaseError
            ? error.message
            : this.transloco.translate('admin.media.editor_upload_failed_reason');
        this.notify.error('admin.media.editor_upload_failed', { name: file.name, reason });
    }

    /** Read on every upload, so a change in Settings → Misc applies at once. */
    private async readSettings(): Promise<MediaUploadSettings> {
        try {
            const snap = await runInInjectionContext(this.injector, () => getDoc(doc(this.firestore, 'Settings', 'misc')));
            return uploadSettingsFromMisc(snap.exists() ? snap.data() : undefined);
        } catch (error) {
            console.error('Error loading media upload settings:', error);
            return uploadSettingsFromMisc(undefined);
        }
    }
}
