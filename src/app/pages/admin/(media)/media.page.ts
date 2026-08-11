import { RouteMeta } from '@analogjs/router';
import { DatePipe, NgClass } from '@angular/common';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ElementRef,
    inject,
    Injector,
    runInInjectionContext,
    ViewChild,
    ViewEncapsulation,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MAT_DIALOG_DATA, MatDialog, MatDialogClose, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinnerModule, ProgressSpinnerMode } from '@angular/material/progress-spinner';
import { SafeHtml } from '@angular/platform-browser';
import { doc, DocumentSnapshot, Firestore, getDoc } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import { DEFAULT_MISC_SETTINGS, IMiscSettings } from '../(settings)/misc/misc-settings.model';
import { MediaUploadSettings } from '../../../../shared/services/file-upload.service';
import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { FileUploadService } from '../../../../shared/services/file-upload.service';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { MediaItem, PaginationInfo } from '../../../../shared/models/media-manage-modal';
import { MediaManagerService } from './media-manager.service';
import { MediaManagerStore } from './media-manager.store';
import { roleGuard } from '../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Media Manager | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

/** Union type for any selectable media (uploaded or Unsplash) */
interface SelectableMedia {
    id: string;
    url?: string;
    name?: string;
    uploadTime?: Date;
    urls?: { regular: string; full?: string; raw?: string };
}

/** Shape of a menu item in the media manager tab bar */
interface MediaMenuItem {
    name: string;
    value: string;
    icon?: string;
}

@Component({
    selector: 'arc-media-manager',
    standalone: true,
    imports: [
        MatPaginatorModule,
        NgClass,
        DatePipe,
        MatFormFieldModule,
        MatInputModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatListModule,
        MatCardModule,
        MatDialogClose,
        MatProgressSpinnerModule,
    ],
    templateUrl: './media-manager.html',
    styleUrls: ['./media-manager.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
})
export default class MediaManagerComponent extends BaseComponent {
    @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
    @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;
    mediaManagerService = inject(MediaManagerService);
    ref = inject(ChangeDetectorRef);
    mediaStore = inject(MediaManagerStore);

    readonly dialog = inject(MatDialog);
    readonly _DIALOG_DATA = inject<{ isDialogOpen: boolean }>(MAT_DIALOG_DATA, { optional: true }) ?? { isDialogOpen: false };
    readonly dialogRef = inject(MatDialogRef<MediaManagerComponent>, { optional: true });
    fileUploadService = inject(FileUploadService);
    private firestore = inject(Firestore);
    private injector = inject(Injector);

    selectedItem: MediaMenuItem | null = null;
    selectedMediaUrl: SelectableMedia | null = null;
    uploadImage: string = '';
    searchResults: MediaItem[] = [];
    pagination: PaginationInfo | null = null;
    showUploadingSpinner = false;
    progressValue = 0;
    mode: ProgressSpinnerMode = 'determinate';
    isSearching = false;
    unsplashConfigured: boolean | null = null;
    selectedImageDimensions: string | null = null;

    // Multi-file upload tracking
    uploadCurrent = 0;
    uploadTotal = 0;

    // Drag-and-drop state
    isDragOver = false;

    // Media upload settings (loaded from Settings/misc)
    private mediaSettings: MediaUploadSettings = {
        maxFileSize: 5,
        maxWidth: 1920,
        maxHeight: 1080,
        convertToWebp: false,
    };

    // Track page documents for backward navigation
    private pageDocumentStack: DocumentSnapshot[] = [];
    currentPageIndex: number = 0;

    // Track subscriptions for cleanup
    private subscriptions: Subscription[] = [];

    ngOnInit(): void {
        this.loadMediaItems();
        this.loadMediaUploadSettings();
        this.selectedMenu({ name: 'Uploaded photos', value: 'upload' });
    }

    ngOnDestroy(): void {
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];
    }

    public searchImage(event?: string, page?: number): void {
        if (event === undefined || event === '') {
            return;
        }
        if (event) {
            this.isSearching = true;
            this.ref.detectChanges();
            this.mediaManagerService
                .getImagesFromUnsplash(event, page || 1)
                .then((result) => {
                    this.isSearching = false;
                    if (result.status === 200) {
                        this.selectedItem!.value = 'search';
                        this.searchResults = result.items;
                        this.pagination = result.pagination;
                        this.ref.detectChanges();
                    }
                })
                .catch((error) => {
                    this.isSearching = false;
                    this.ref.detectChanges();
                    console.error('Error occurred while retrieving images from unsplash', error);
                    this.toastService.error('Failed to search images. Please try again.');
                });
        } else {
            this.searchResults = [];
            this.selectedItem = null;
            this.selectedMediaUrl = null;
        }
    }

    public selectedMenu(event: MediaMenuItem): void {
        this.searchResults = [];
        this.pagination = null;
        this.selectedMediaUrl = null;
        this.selectedItem = event;
        // Reset page tracking when switching menus
        this.pageDocumentStack = [];
        this.currentPageIndex = 0;

        switch (event.value) {
            case 'upload':
                this.loadMediaItems();
                break;

            case 'search':
                this.uploadImage = '';
                this.unsplashConfigured = null;
                this.ref.detectChanges();
                this.mediaManagerService.isUnsplashConfigured().then((configured) => {
                    this.unsplashConfigured = configured;
                    if (configured) {
                        // Pre-warm the Cloud Function to reduce cold-start latency
                        this.mediaManagerService.warmupUnsplash();
                        // Focus the search input after a short delay to ensure it's rendered
                        setTimeout(() => {
                            this.searchInput?.nativeElement?.focus();
                        }, 100);
                    }
                    this.ref.detectChanges();
                });
                break;

            default:
                break;
        }
    }

    public navigateToIntegrations(): void {
        if (this.dialogRef) {
            this.dialogRef.close({ type: 'navigate' });
        }
        this.router.navigate(['/admin/settings/integrations']);
    }

    public selectMedia(selectedMediaUrl: SelectableMedia): void {
        this.selectedMediaUrl = selectedMediaUrl;
        this.selectedImageDimensions = null;
        this.ref.detectChanges();

        const imageUrl = selectedMediaUrl.urls?.regular || selectedMediaUrl.url;
        if (imageUrl) {
            const img = new Image();
            img.onload = () => {
                this.selectedImageDimensions = `${img.naturalWidth} × ${img.naturalHeight}`;
                this.ref.detectChanges();
            };
            img.src = imageUrl;
        }
    }

    public insertMedia() {
        const selectedMedia = this.selectedMediaUrl?.url || this.selectedMediaUrl?.urls?.regular || '';
        if (this.dialogRef) {
            this.dialogRef.close({ mediaUrl: selectedMedia, type: 'submit' });
        }
    }

    /**
     * Handle file selection from either the file input or drag-and-drop.
     * Supports multiple files. Validates types upfront, then uploads sequentially.
     */
    public onFileChange(event: Event | DragEvent): void {
        if (this.showUploadingSpinner) {
            return;
        }

        let fileList: FileList | null = null;

        if (typeof DragEvent !== 'undefined' && event instanceof DragEvent) {
            fileList = event.dataTransfer?.files ?? null;
        } else {
            const input = event.target as HTMLInputElement;
            fileList = input.files ?? null;
        }

        if (!fileList || fileList.length === 0) {
            return;
        }

        // Snapshot the files before clearing the input (clearing empties the FileList)
        const validFiles: File[] = [];
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const typeError = this.fileUploadService.validateFileType(file);
            if (typeError) {
                this.toastService.error(`${file.name}: ${typeError}`);
            } else {
                validFiles.push(file);
            }
        }

        // Clear the input so the same files can be re-selected
        if (!(typeof DragEvent !== 'undefined' && event instanceof DragEvent)) {
            (event.target as HTMLInputElement).value = '';
        }

        if (validFiles.length === 0) {
            return;
        }

        // Show preview of first file
        this.uploadImage = URL.createObjectURL(validFiles[0]);
        this.ref.detectChanges();

        this.uploadFilesSequentially(validFiles);
    }

    /**
     * Upload validated files sequentially to Firebase Storage,
     * then batch-write all metadata to Firestore and refresh the list.
     */
    private async uploadFilesSequentially(files: File[]): Promise<void> {
        this.showUploadingSpinner = true;
        this.uploadTotal = files.length;
        this.uploadCurrent = 0;
        this.ref.detectChanges();

        const results: any[] = [];

        for (const file of files) {
            this.uploadCurrent++;
            this.uploadImage = URL.createObjectURL(file);
            this.progressValue = 0;
            this.ref.detectChanges();

            try {
                const data = await this.fileUploadService.uploadFile(
                    file,
                    this.mediaSettings,
                    (progress: number) => {
                        this.progressValue = progress;
                        this.ref.detectChanges();
                    },
                );
                results.push(data);
            } catch (error) {
                console.error(`Failed to upload ${file.name}:`, error);
                const message = error instanceof Error ? error.message : 'Upload failed.';
                this.toastService.error(`${file.name}: ${message}`);
            }
        }

        // Reset upload UI state
        this.showUploadingSpinner = false;
        this.uploadImage = '';
        this.selectedMediaUrl = null;
        this.uploadCurrent = 0;
        this.uploadTotal = 0;
        this.pagination = null;
        this.pageDocumentStack = [];
        this.currentPageIndex = 0;

        if (results.length > 0) {
            // Batch-write all metadata to Firestore, then refresh gallery
            const sub = this.mediaStore.addBatch(results).subscribe({
                next: () => {
                    this.loadMediaItems();
                },
                error: (err: any) => {
                    console.error('Failed to save media metadata:', err);
                    this.toastService.error('Images uploaded but failed to save metadata.');
                    this.loadMediaItems();
                },
            });
            this.subscriptions.push(sub);
        }

        this.ref.detectChanges();
    }

    private loadMediaItems(pageSize: number = 20, lastVisible?: DocumentSnapshot) {
        const sub = this.mediaManagerService.getMediaListFromFirestore(pageSize, lastVisible).subscribe({
            next: (response) => {
                // Always replace items (we handle stack-based navigation)
                this.searchResults = response.items;
                this.pagination = response.pagination;
                this.ref.detectChanges();
            },
            error: (error) => {
                console.error(error);
                this.toastService.error('Failed to load media items.');
            },
        });
        this.subscriptions.push(sub);
    }

    public async getPaginatorData(event: any) {
        const pageSize = 20;

        if (this.selectedItem?.value === 'search') {
            if (this.searchValue) {
                await this.searchImage(this.searchValue, event.pageIndex + 1);
            }
        } else {
            if (event.pageIndex > event.previousPageIndex!) {
                // Moving forward - save current document for backward navigation
                if (this.pagination?.lastVisible) {
                    this.pageDocumentStack.push(this.pagination.lastVisible);
                }
                this.currentPageIndex = event.pageIndex;
                await this.loadMediaItems(pageSize, this.pagination?.lastVisible);
            } else {
                // Moving backward
                this.handleBackwardPagination(event.pageIndex, pageSize);
            }
        }
    }

    private handleBackwardPagination(targetPageIndex: number, pageSize: number) {
        // Going to first page
        if (targetPageIndex === 0) {
            this.pageDocumentStack = [];
            this.currentPageIndex = 0;
            this.loadMediaItems(pageSize);
            return;
        }

        // Pop documents from stack until we reach the target page
        while (this.pageDocumentStack.length > targetPageIndex) {
            this.pageDocumentStack.pop();
        }

        this.currentPageIndex = targetPageIndex;

        // Load from the document at target position (or undefined for first page)
        const startAfterDoc = this.pageDocumentStack[targetPageIndex - 1];
        this.loadMediaItems(pageSize, startAfterDoc);
    }

    public confirmationToDeleteItem(media: MediaItem) {
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(`Are you sure you want to delete ${media.name}?`);
        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            width: '350px',
            data: {
                dialogType: 'Delete',
                dialogMessage: msg,
                btnText: 'Delete',
                panelType: 'warn',
            },
        });
        dialogRef.afterClosed().subscribe((result: any) => {
            if (result) {
                this.deleteUploadedMedia(media.id);
            }
        });
    }

    async deleteUploadedMedia(mediaId: string) {
        try {
            await this.fileUploadService.deleteMediaItem(mediaId);
            this.loadMediaItems();
        } catch (error) {
            console.error('Failed to delete media item:', error);
            this.toastService.error('Failed to delete media item. Please try again.');
        }
    }

    getUrl(element: any): string {
        return element?.urls?.regular ?? '';
    }

    handleImageError(event: any) {
        event.target.src = 'https://placehold.co/600x400/CCCCCC/FFFFFF?text=Preview';
    }

    /** Open the selected media's full-size image in a new browser tab */
    openFullImage() {
        const url = this.selectedMediaUrl?.urls?.full
            || this.selectedMediaUrl?.urls?.raw
            || this.selectedMediaUrl?.urls?.regular
            || this.selectedMediaUrl?.url;
        if (url) {
            window.open(url, '_blank');
        }
    }

    openFilePicker(): void {
        this.fileInputRef?.nativeElement?.click();
    }

    /** Drag-and-drop handlers */
    onDragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragOver = true;
        this.ref.detectChanges();
    }

    onDragLeave(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragOver = false;
        this.ref.detectChanges();
    }

    onDrop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragOver = false;
        this.onFileChange(event);
    }

    /**
     * Load media upload settings from Settings/misc.
     * Falls back to defaults if the document doesn't exist.
     */
    private async loadMediaUploadSettings(): Promise<void> {
        try {
            const docSnap = await runInInjectionContext(this.injector, () => {
                const docRef = doc(this.firestore, 'Settings', 'misc');
                return getDoc(docRef);
            });
            if (docSnap.exists()) {
                const data = { ...DEFAULT_MISC_SETTINGS, ...docSnap.data() } as IMiscSettings;
                this.mediaSettings = {
                    maxFileSize: data.mediaMaxFileSize ?? 5,
                    maxWidth: data.mediaMaxWidth ?? 1920,
                    maxHeight: data.mediaMaxHeight ?? 1080,
                    convertToWebp: data.mediaConvertToWebp ?? false,
                };
            }
        } catch (error) {
            console.error('Error loading media upload settings:', error);
        }
    }
}
