import { RouteMeta } from '@analogjs/router';
import { DatePipe, NgClass } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
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
import { firstValueFrom, Subscription } from 'rxjs';
import { DEFAULT_MISC_SETTINGS, IMiscSettings } from '../(settings)/misc/misc-settings.model';
import { DEFAULT_UPLOAD_SETTINGS, MediaUploadSettings, UploadedMedia } from '../../../../shared/services/file-upload.service';
import { ImageVariant } from '../../../../shared/services/file-upload.service';
import { DEFAULT_IMAGE_SIZE, IMAGE_SIZE_LABELS, IMAGE_SIZES, ImageSize, imageSizeUrls, imageSizeLimits } from '../../../../shared/utils/image-sizes';
import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { FileUploadService } from '../../../../shared/services/file-upload.service';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { MediaItem, PaginationInfo } from '../../../../shared/models/media-manage-modal';
import { MediaManagerService } from './media-manager.service';
import { MediaManagerStore } from './media-manager.store';
import { roleGuard } from '../../../guards/role.guard';
import { IconBrowserComponent } from '../../../../shared/components/icon-browser/icon-browser.component';
import { ArcIcon } from '../../../../shared/models/icon.model';
import { escapeHtml } from '../../../../shared/utils/escape-html';
import { ImageCropperComponent, CropImageSize } from '../../../../shared/components/image-cropper/image-cropper.component';
import { CROP_RATIOS, CropRatio, CropRect, cropRatioValue, isWholeImage, scaleCropRect, unsplashCropUrl } from '../../../../shared/utils/image-crop';
import { mimeTypeOfName } from '../../../../shared/services/file-upload.service';

export const routeMeta: RouteMeta = {
    title: 'Media Manager',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

/** Union type for any selectable media (uploaded or Unsplash) */
interface SelectableMedia {
    id: string;
    url?: string;
    name?: string;
    uploadTime?: Date;
    urls?: { regular: string; full?: string; raw?: string; small?: string };
    /** The stored sizes of an upload. Absent on Unsplash results and on uploads older than sizes. */
    variants?: Record<ImageSize, ImageVariant>;
    /** An Unsplash photo's original size, which its crop is measured in. */
    width?: number;
    height?: number;
}

/** Shape of a menu item in the media manager tab bar */
interface MediaMenuItem {
    name: string;
    value: string;
    icon?: string;
    /** What this tab produces. Tabs whose kind the caller cannot use are hidden. */
    kind?: 'image' | 'icon';
}

/**
 * What a caller passes when opening the Media Manager as a dialog.
 *
 * The two `allow*` flags describe what the caller can accept back. A caller
 * that only understands one of them gets a dialog with only those tabs — and
 * with no tab bar at all, since a single tab is not a choice.
 */
export interface MediaDialogData {
    isDialogOpen: boolean;
    /** Show the upload and Unsplash tabs. Defaults to true. */
    allowImages?: boolean;
    /** Show the Icons tab. Defaults to false. */
    allowIcons?: boolean;
    /**
     * Let the admin pick several images in one visit.
     *
     * For a caller that creates one thing per selection — a gallery row per
     * photo — where picking twelve images otherwise means opening this dialog
     * twelve times.
     */
    multiple?: boolean;
    /** Tab to open on, e.g. `icons` for a field that only wants a glyph. */
    initialTab?: string;
    /**
     * The size preselected in the picker — what the caller recommends for
     * the slot being filled (a cover image wants XL; a thumbnail S). M when
     * omitted. The admin can still pick another.
     */
    size?: ImageSize;
    /**
     * The ratio the crop frame opens with when the admin crops: what the
     * caller's slot wants (`1:1` for a square card). Free when omitted. The
     * admin can still pick another.
     */
    cropRatio?: CropRatio;
}

/** What the dialog hands back when the admin confirms a selection. */
export interface MediaSelection {
    type: 'submit';
    /**
     * The image URL, kept for every existing caller. Empty for an icon
     * selection — a caller that only understands images sees "nothing chosen"
     * rather than a URL that does not resolve.
     */
    mediaUrl: string;
    /** Which kind of thing was picked. Absent on older callers' expectations. */
    kind?: 'image' | 'icon';
    /** Present only when `kind` is `icon`. */
    icon?: ArcIcon;
    /**
     * Every image picked, when the caller asked for `multiple`.
     *
     * `mediaUrl` still holds the first of them, so a caller that does not know
     * about this field keeps working rather than receiving nothing.
     */
    mediaUrls?: string[];
    /** The size the admin picked; `mediaUrl` (and `mediaUrls`) already point at it. */
    size?: ImageSize;
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
        MatProgressSpinnerModule, TranslocoPipe, IconBrowserComponent, ImageCropperComponent],
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
    readonly _DIALOG_DATA = inject<MediaDialogData>(MAT_DIALOG_DATA, { optional: true }) ?? { isDialogOpen: false };
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
    /** The size an insert hands back: the caller's recommendation, else M, unless the admin picks another. */
    selectedSize: ImageSize = this._DIALOG_DATA.size ?? DEFAULT_IMAGE_SIZE;
    readonly imageSizes = IMAGE_SIZES;
    readonly imageSizeLabels = IMAGE_SIZE_LABELS;
    /** The icon highlighted in the Icons tab, if any. */
    selectedIcon: ArcIcon | null = null;
    /**
     * Every image picked in multi-select mode, in the order they were chosen.
     *
     * Order matters: it becomes the order of the gallery rows created from it,
     * and an admin clicking photos in sequence expects that sequence.
     */
    selectedMediaList: SelectableMedia[] = [];

    // Cropping. The frame sits over the image shown in the crop step: an
    // upload's XL file, or an Unsplash photo's 1080 px copy.
    readonly cropRatios = CROP_RATIOS;
    isCropping = false;
    cropRatio: CropRatio = this._DIALOG_DATA.cropRatio ?? 'free';
    /** The frame, in the pixels of the image shown in the crop step. */
    cropRect: CropRect | null = null;
    cropImageSize: CropImageSize | null = null;
    isSavingCrop = false;
    cropProgress = 0;
    /** Each Unsplash photo's crop, in its original pixels, by photo id. */
    private unsplashCrops = new Map<string, CropRect>();
    /** Set once the view is gone, so a save finishing after the dialog closed leaves the view alone. */
    private destroyed = false;

    // Multi-file upload tracking
    uploadCurrent = 0;
    uploadTotal = 0;

    // Drag-and-drop state
    isDragOver = false;

    // Media upload settings (loaded from Settings/misc)
    private mediaSettings: MediaUploadSettings = { ...DEFAULT_UPLOAD_SETTINGS };
    /** Resolves once Settings/misc has been read, so an upload never runs on the defaults by accident. */
    private mediaSettingsLoaded: Promise<void> = Promise.resolve();

    // Track page documents for backward navigation
    private pageDocumentStack: DocumentSnapshot[] = [];
    currentPageIndex: number = 0;

    // Track subscriptions for cleanup
    private subscriptions: Subscription[] = [];

    /**
     * The tabs this instance shows — only those producing something the caller
     * can accept.
     *
     * A caller asking for neither kind is a mistake, not a request for an
     * empty dialog, so images win: that is what every caller predating the
     * flags expects.
     */
    get menuItems(): MediaMenuItem[] {
        const data = this._DIALOG_DATA;
        const allowIcons = data.allowIcons === true;
        const allowImages = data.allowImages !== false || !allowIcons;

        const menu = this.constantVariables.mediaManagerMenu as MediaMenuItem[];
        return menu.filter(item =>
            item.kind === 'icon' ? allowIcons : allowImages,
        );
    }

    /**
     * Whether to draw the tab bar. One tab is not a choice — showing a lone
     * highlighted "Icons" tab just implies there are others to switch to.
     */
    get showTabBar(): boolean {
        return this.menuItems.length > 1;
    }

    ngOnInit(): void {
        const initial = this.menuItems.find(item => item.value === this._DIALOG_DATA.initialTab)
            ?? this.menuItems[0];

        // Upload limits are only read to validate an upload; an icons-only
        // dialog cannot upload anything, so skip the Firestore round-trip.
        if (this.menuItems.some(item => item.kind === 'image')) {
            this.mediaSettingsLoaded = this.loadMediaUploadSettings();
        }

        this.selectedMenu(initial);
    }

    ngOnDestroy(): void {
        this.destroyed = true;
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
                    this.notify.error('admin.media.search_failed');
                });
        } else {
            this.searchResults = [];
            this.selectedItem = null;
            this.selectedMediaUrl = null;
        }
    }

    public selectedMenu(event: MediaMenuItem): void {
        // A cropped copy being saved will select itself in My Uploads when it
        // lands; switching tabs under it would mix its list into another tab.
        if (this.isSavingCrop) return;
        this.searchResults = [];
        this.pagination = null;
        this.selectedMediaUrl = null;
        this.selectedIcon = null;
        this.selectedMediaList = [];
        this.closeCrop();
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

    /** An icon was highlighted in the Icons tab. */
    public onIconSelected(icon: ArcIcon | null): void {
        this.selectedIcon = icon;
        this.ref.detectChanges();
    }

    /** True when the caller asked to pick more than one image. */
    get isMultiSelect(): boolean {
        return this._DIALOG_DATA.multiple === true;
    }

    /** Whether an item is in the multi-select basket. */
    public isPicked(item: SelectableMedia): boolean {
        return this.selectedMediaList.some((picked) => picked.id === item.id);
    }

    /** Position in the basket, 1-based — shown on the tile so the order is visible. */
    public pickIndex(item: SelectableMedia): number {
        return this.selectedMediaList.findIndex((picked) => picked.id === item.id) + 1;
    }

    public selectMedia(selectedMediaUrl: SelectableMedia): void {
        if (this.isMultiSelect) {
            // Clicking a picked tile takes it back out, which is the only
            // way to correct a mis-click without starting over.
            this.selectedMediaList = this.isPicked(selectedMediaUrl)
                ? this.selectedMediaList.filter((picked) => picked.id !== selectedMediaUrl.id)
                : [...this.selectedMediaList, selectedMediaUrl];
        }

        this.selectedMediaUrl = selectedMediaUrl;
        this.selectedImageDimensions = null;
        this.ref.detectChanges();

        const crop = this.unsplashCrops.get(selectedMediaUrl.id);
        if (crop) {
            this.selectedImageDimensions = `${crop.width} × ${crop.height}`;
            this.ref.detectChanges();
            return;
        }

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

    /**
     * Closes the dialog with whatever is selected.
     *
     * `mediaUrl` stays first-class so the four callers that read only that
     * field keep working untouched. An icon leaves it empty rather than
     * inventing a URL — a caller that does not know about `kind` then treats
     * the result as "nothing picked", which is the safe reading.
     */
    public insertMedia() {
        if (!this.dialogRef) return;

        if (this.isIconsTab && this.selectedIcon) {
            const selection: MediaSelection = {
                type: 'submit',
                mediaUrl: '',
                kind: 'icon',
                icon: this.selectedIcon,
            };
            this.dialogRef.close(selection);
            return;
        }

        if (this.isMultiSelect) {
            const urls = this.selectedMediaList
                .map((picked) => this.urlAtSize(picked, this.selectedSize))
                .filter(Boolean);

            this.dialogRef.close({
                type: 'submit',
                kind: 'image',
                mediaUrl: urls[0] ?? '',
                mediaUrls: urls,
                size: this.selectedSize,
            } satisfies MediaSelection);
            return;
        }

        const selectedMedia = this.selectedMediaUrl ? this.urlAtSize(this.selectedMediaUrl, this.selectedSize) : '';
        const selection: MediaSelection = { type: 'submit', mediaUrl: selectedMedia, kind: 'image', size: this.selectedSize };
        this.dialogRef.close(selection);
    }

    /**
     * The URL of `media` at `size`.
     *
     * An upload with stored sizes answers from them. An Unsplash photo is
     * resized by its CDN. An upload from before sizes existed has one file,
     * which is what every size returns — the chips are disabled for it.
     */
    urlAtSize(media: SelectableMedia, size: ImageSize): string {
        if (media.variants?.[size]?.url) return media.variants[size].url;
        const crop = this.unsplashCrops.get(media.id);
        const uncropped = media.urls?.raw || media.urls?.regular || media.url || '';
        const source = crop && media.urls ? unsplashCropUrl(uncropped, crop) : uncropped;
        return imageSizeUrls(source, this.mediaSettings.maxSize)?.[size] ?? source;
    }

    /** True when the selection can actually be handed back in more than one size. */
    hasSizeChoice(media: SelectableMedia | null): boolean {
        if (!media) return false;
        if (media.variants) return true;
        return !!media.urls?.raw;
    }

    /** "300 × 200" for a stored size, or the longest-side limit for a CDN-resized photo. */
    sizeDimensions(media: SelectableMedia, size: ImageSize): string {
        const variant = media.variants?.[size];
        if (variant) return `${variant.width} × ${variant.height}`;
        return `≤ ${imageSizeLimits(this.mediaSettings.maxSize)[size]} px`;
    }

    selectSize(size: ImageSize): void {
        this.selectedSize = size;
        this.ref.detectChanges();
    }

    /** The small size for a grid tile, so the gallery does not download every image at full width. */
    thumbnailUrl(media: SelectableMedia): string {
        return media.variants?.s?.url || media.url || '';
    }

    /** The preview panel's image: an Unsplash photo shows its crop. */
    previewUrl(media: SelectableMedia | null): string {
        if (!media) return '';
        const shown = media.urls?.regular || media.url || '';
        const crop = this.unsplashCrops.get(media.id);
        return crop && media.urls ? unsplashCropUrl(shown, crop) : shown;
    }

    /** True when the Unsplash photo has a crop the insert will carry. */
    isCropped(media: SelectableMedia | null): boolean {
        return !!media && this.unsplashCrops.has(media.id);
    }

    /**
     * Whether `media` can be cropped here. Not in multi-select (one frame
     * cannot serve twelve photos), and not a GIF (cropping would drop the
     * animation). An Unsplash photo needs its original size to place `rect`,
     * and is only worth cropping when it is about to be inserted.
     */
    canCrop(media: SelectableMedia | null): boolean {
        if (!media || this.isMultiSelect || this.isIconsTab) return false;
        if (media.urls) {
            return this._DIALOG_DATA.isDialogOpen && !!media.urls.raw && !!media.width && !!media.height;
        }
        const name = media.name || media.url || '';
        return !!media.url && mimeTypeOfName(name.split('?')[0]) !== 'image/gif';
    }

    /** The image the crop step shows, and crops: an upload's largest size, or Unsplash's 1080 px copy. */
    get cropSourceUrl(): string {
        const media = this.selectedMediaUrl;
        if (!media) return '';
        return media.urls?.regular || media.variants?.xl?.url || media.url || '';
    }

    /** True when the crop step works on an upload (and saves a copy), not an Unsplash photo. */
    get isCroppingUpload(): boolean {
        return !this.selectedMediaUrl?.urls;
    }

    /** The frame's ratio as a number, or null when free. */
    get cropRatioNumber(): number | null {
        const size = this.cropImageSize;
        if (this.cropRatio === 'original') return size ? size.width / size.height : null;
        return cropRatioValue(this.cropRatio, 1, 1);
    }

    /** The cropped image's size in its own pixels: what the result will measure. */
    get cropResultSize(): { width: number; height: number } | null {
        const rect = this.cropRect;
        const size = this.cropImageSize;
        const media = this.selectedMediaUrl;
        if (!rect || !size || !media) return null;
        if (media.urls && media.width && media.height) {
            const raw = scaleCropRect(rect, size.width, size.height, media.width, media.height);
            return { width: raw.width, height: raw.height };
        }
        return { width: rect.width, height: rect.height };
    }

    /**
     * True when the crop is smaller than the size picked, so that size will
     * be the crop as it is (never enlarged) and may look soft where the slot
     * is large. Only in the picker: the Media Manager page picks no size.
     */
    get cropTooSmall(): boolean {
        const result = this.cropResultSize;
        if (!result || !this._DIALOG_DATA.isDialogOpen) return false;
        return Math.max(result.width, result.height) < imageSizeLimits(this.mediaSettings.maxSize)[this.selectedSize];
    }

    get selectedSizeLimit(): number {
        return imageSizeLimits(this.mediaSettings.maxSize)[this.selectedSize];
    }

    /** Drops an Unsplash photo's crop: the insert is the whole photo again. */
    removeCrop(): void {
        const media = this.selectedMediaUrl;
        if (!media) return;
        this.unsplashCrops.delete(media.id);
        this.selectMedia(media);
    }

    startCrop(): void {
        if (!this.canCrop(this.selectedMediaUrl)) return;
        this.isCropping = true;
        this.cropRatio = this._DIALOG_DATA.cropRatio ?? 'free';
        this.cropRect = null;
        this.cropImageSize = null;
        this.ref.detectChanges();
    }

    /** Leaves the crop step without changing anything. */
    cancelCrop(): void {
        if (this.isSavingCrop) return;
        this.closeCrop();
        this.ref.detectChanges();
    }

    private closeCrop(): void {
        this.isCropping = false;
        this.cropRect = null;
        this.cropImageSize = null;
        this.cropProgress = 0;
    }

    selectCropRatio(ratio: CropRatio): void {
        this.cropRatio = ratio;
        this.ref.detectChanges();
    }

    onCropLoaded(size: CropImageSize): void {
        this.cropImageSize = size;
        this.ref.detectChanges();
    }

    onCropRect(rect: CropRect): void {
        this.cropRect = rect;
        this.ref.detectChanges();
    }

    onCropFailed(): void {
        this.notify.error('admin.media.crop.load_failed');
        this.closeCrop();
        this.ref.detectChanges();
    }

    /**
     * Applies the frame. An Unsplash photo keeps the crop as a URL setting
     * for the insert (a frame over the whole photo clears it). An upload is
     * saved as a new cropped image, selected once it is in the library; the
     * original stays as it was.
     */
    async applyCrop(): Promise<void> {
        const media = this.selectedMediaUrl;
        const rect = this.cropRect;
        const size = this.cropImageSize;
        if (!media || !rect || !size || this.isSavingCrop) return;

        const whole = isWholeImage(rect, size.width, size.height);

        if (media.urls) {
            if (whole) {
                this.unsplashCrops.delete(media.id);
            } else {
                this.unsplashCrops.set(media.id, scaleCropRect(rect, size.width, size.height, media.width!, media.height!));
            }
            this.closeCrop();
            this.selectMedia(media);
            return;
        }

        if (whole) {
            this.closeCrop();
            this.ref.detectChanges();
            return;
        }

        this.isSavingCrop = true;
        this.cropProgress = 0;
        this.ref.detectChanges();
        await this.mediaSettingsLoaded;

        try {
            // The frame was placed on the XL file; the bytes are that same file.
            const source = await this.mediaManagerService.readMediaImage(media.id);
            const saved = await this.fileUploadService.uploadCroppedCopy(
                source,
                media.name || media.url || 'image',
                rect,
                this.mediaSettings,
                (progress) => {
                    this.cropProgress = progress;
                    this.ref.detectChanges();
                },
            );
            const ids = await firstValueFrom(this.mediaStore.addBatch([saved]));
            this.isSavingCrop = false;
            if (this.destroyed) return;
            this.closeCrop();
            // The copy is the newest upload, so it heads the first page.
            this.pagination = null;
            this.pageDocumentStack = [];
            this.currentPageIndex = 0;
            this.loadMediaItems();
            this.selectMedia({
                id: ids[0],
                url: saved.downloadURL,
                name: saved.name,
                uploadTime: saved.uploadTime,
                variants: saved.variants,
            });
            this.notify.success('admin.media.crop.saved');
        } catch (error) {
            console.error('Failed to save the cropped image:', error);
            this.isSavingCrop = false;
            if (this.destroyed) return;
            this.notify.error('admin.media.crop.save_failed', { reason: error instanceof Error ? error.message : '' });
        }
        this.ref.detectChanges();
    }

    /** True while the Icons tab is the active one. */
    get isIconsTab(): boolean {
        return this.selectedItem?.value === 'icons';
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

        // A fast admin can drop a file before Settings/misc has answered;
        // uploading on the defaults would silently ignore their limits.
        await this.mediaSettingsLoaded;

        const results: UploadedMedia[] = [];

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
                    this.notify.error('admin.media.metadata_failed');
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
                this.notify.error('admin.media.load_failed');
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
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(`Are you sure you want to delete ${escapeHtml(media.name)}?`);
        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            width: '350px',
            data: {
                dialogType: 'Delete',
                dialogMessage: msg,
                btnText: this.t('common.actions.delete'),
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
            // The preview and the pick list must not keep showing an item
            // that no longer exists.
            if (this.selectedMediaUrl?.id === mediaId) {
                this.selectedMediaUrl = null;
                this.selectedImageDimensions = null;
            }
            this.selectedMediaList = this.selectedMediaList.filter((picked) => picked.id !== mediaId);
            this.loadMediaItems();
        } catch (error) {
            console.error('Failed to delete media item:', error);
            this.notify.error('admin.media.delete_failed');
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
                // Older Settings docs carry mediaMaxWidth/Height; those are
                // deliberately not read — the longest-side limit is its own
                // setting, and a stale 1920 must not leak into new uploads.
                this.mediaSettings = {
                    maxFileSize: data.mediaMaxFileSize ?? DEFAULT_UPLOAD_SETTINGS.maxFileSize,
                    maxSize: data.mediaMaxSize ?? DEFAULT_UPLOAD_SETTINGS.maxSize,
                    convertToWebp: data.mediaConvertToWebp ?? DEFAULT_UPLOAD_SETTINGS.convertToWebp,
                };
            }
        } catch (error) {
            console.error('Error loading media upload settings:', error);
        }
    }
}
