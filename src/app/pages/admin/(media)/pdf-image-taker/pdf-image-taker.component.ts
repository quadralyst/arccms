import {
    afterNextRender,
    Component,
    computed,
    DestroyRef,
    effect,
    ElementRef,
    inject,
    Injector,
    input,
    output,
    signal,
    viewChildren,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { CropImageSize, ImageCropperComponent } from '../../../../../shared/components/image-cropper/image-cropper.component';
import { FileUploadService, MediaUploadSettings, UploadedMedia } from '../../../../../shared/services/file-upload.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { CROP_RATIOS, CropRatio, CropRect, cropRatioValue } from '../../../../../shared/utils/image-crop';
import { frameToPdfRect, openPdf, PdfDocument, PdfOpenError, saveScale } from '../../../../../shared/utils/pdf-pages';
import { MediaManagerStore } from '../media-manager.store';

/** Where the PDF comes from: a file on the admin's computer, or one in the library. */
export interface PdfImageSource {
    /** The PDF's title; images are named after it ("Brochure, page 3"). */
    title: string;
    /** The library file, when it is one; saved images record it (MF4). */
    fileId?: string;
    /** The PDF's bytes. Progress, when reading takes a while, is 0 to 100. */
    load: (onProgress: (percent: number) => void) => Promise<Blob>;
}

/** An image saved from a page, as the media page selects it. */
export interface PdfImageSaved {
    id: string;
    media: UploadedMedia;
}

/** The longest side of a page in the grid. */
const THUMB_SIZE = 240;
/** The longest side of the page the crop frame is placed on. */
const CROP_VIEW_SIZE = 1600;

type Step = 'loading' | 'pages' | 'crop' | 'error';

/**
 * Take an image from a PDF (docs/features/media.html, Take an image from a
 * PDF; MF3 and MF4). The pages show as a grid, drawn as they scroll into
 * view; clicking one opens the crop step admins know from cropping an
 * upload. Save draws only the framed part again, at the XL size (MF-D14),
 * and stores it as a normal upload in My Uploads, then returns to the pages
 * so another can be taken (MF-D15). The PDF itself is never changed.
 */
@Component({
    selector: 'arc-pdf-image-taker',
    standalone: true,
    imports: [TranslocoPipe, ImageCropperComponent],
    templateUrl: './pdf-image-taker.component.html',
    styleUrl: './pdf-image-taker.component.scss',
})
export class PdfImageTakerComponent {
    private fileUpload = inject(FileUploadService);
    private mediaStore = inject(MediaManagerStore);
    private notify = inject(NotifyService);
    private i18n = inject(TranslocoService);
    private injector = inject(Injector);

    readonly source = input.required<PdfImageSource>();
    readonly uploadSettings = input.required<MediaUploadSettings>();
    /** The ratio the frame opens with: the caller's slot (MediaDialogData.cropRatio). */
    readonly initialRatio = input<CropRatio>('free');
    /** The size the caller picked, for the "too small" note; null on the Media page. */
    readonly sizeLimit = input<{ label: string; limit: number } | null>(null);
    /** Offer "Keep the whole PDF in Files instead" (a PDF dropped on My Uploads, MF-D11). */
    readonly offerKeepInFiles = input(false);

    readonly saved = output<PdfImageSaved>();
    readonly done = output<void>();
    readonly keepInFiles = output<void>();

    readonly cropRatios = CROP_RATIOS;
    readonly step = signal<Step>('loading');
    readonly loadPercent = signal<number | null>(null);
    readonly problem = signal<'locked' | 'unreadable' | 'read_failed'>('unreadable');
    readonly pageCount = signal(0);
    readonly pageNumbers = computed(() => Array.from({ length: this.pageCount() }, (_, i) => i + 1));
    /** Drawn page thumbnails by page number. */
    readonly thumbs = signal<Record<number, string>>({});
    readonly savedCount = signal(0);

    readonly cropPage = signal<number | null>(null);
    readonly cropUrl = signal<string | null>(null);
    readonly ratio = signal<CropRatio>('free');
    readonly cropRect = signal<CropRect | null>(null);
    readonly cropImageSize = signal<CropImageSize | null>(null);
    readonly saving = signal(false);
    readonly saveProgress = signal(0);

    private readonly tiles = viewChildren<ElementRef<HTMLElement>>('tile');
    private pdf: PdfDocument | null = null;
    /** The scale the crop view was drawn at, in pixels per PDF point. */
    private cropScale = 1;
    private observer: IntersectionObserver | null = null;
    private queue: number[] = [];
    private drawing = false;
    private destroyed = false;
    private objectUrls: string[] = [];
    private cropObjectUrl: string | null = null;

    readonly ratioNumber = computed(() => {
        const size = this.cropImageSize();
        if (this.ratio() === 'original') return size ? size.width / size.height : null;
        return cropRatioValue(this.ratio(), 1, 1);
    });

    /** What the saved image will measure: the frame at the save scale (MF-D14). */
    readonly resultSize = computed(() => {
        const rect = this.cropRect();
        if (!rect) return null;
        const pdfRect = frameToPdfRect(rect, this.cropScale);
        const scale = saveScale(pdfRect, this.uploadSettings().maxSize);
        const width = Math.round(pdfRect.width * scale);
        const height = Math.round(pdfRect.height * scale);
        const longest = Math.max(width, height);
        const max = this.uploadSettings().maxSize;
        // Stored sizes never pass the XL limit.
        if (longest <= max) return { width, height };
        return { width: Math.round((width * max) / longest), height: Math.round((height * max) / longest) };
    });

    readonly tooSmall = computed(() => {
        const result = this.resultSize();
        const limit = this.sizeLimit();
        return !!result && !!limit && Math.max(result.width, result.height) < limit.limit;
    });

    constructor() {
        const destroyRef = inject(DestroyRef);
        destroyRef.onDestroy(() => this.teardown());

        effect(() => {
            const source = this.source();
            void this.open(source);
        });

        // Watch the tiles once they exist, and again whenever the grid is redrawn.
        effect(() => {
            const tiles = this.tiles();
            if (this.step() !== 'pages') return;
            afterNextRender(() => this.observe(tiles.map((t) => t.nativeElement)), { injector: this.injector });
        });
    }

    private async open(source: PdfImageSource): Promise<void> {
        this.step.set('loading');
        this.loadPercent.set(null);
        let bytes: Blob;
        try {
            bytes = await source.load((percent) => this.loadPercent.set(Math.round(percent)));
        } catch (error) {
            console.error('Could not read the PDF:', error);
            if (this.destroyed) return;
            this.problem.set('read_failed');
            this.step.set('error');
            return;
        }
        try {
            this.pdf = await openPdf(bytes);
        } catch (error) {
            if (this.destroyed) return;
            this.problem.set(error instanceof PdfOpenError ? error.problem : 'unreadable');
            this.step.set('error');
            return;
        }
        if (this.destroyed) {
            void this.pdf.destroy();
            return;
        }
        this.pageCount.set(this.pdf.pageCount);
        this.step.set('pages');
    }

    /**
     * Draws thumbnails as tiles come into view. Without IntersectionObserver
     * (old browsers, tests) the first twelve pages are drawn.
     */
    private observe(elements: HTMLElement[]): void {
        this.observer?.disconnect();
        if (typeof IntersectionObserver === 'undefined') {
            this.pageNumbers().slice(0, 12).forEach((page) => this.enqueue(page));
            return;
        }
        this.observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const page = Number((entry.target as HTMLElement).dataset['page']);
                if (page) this.enqueue(page);
                this.observer?.unobserve(entry.target);
            }
        }, { rootMargin: '200px' });
        for (const element of elements) {
            if (!this.thumbs()[Number(element.dataset['page'])]) this.observer.observe(element);
        }
    }

    private enqueue(page: number): void {
        if (this.thumbs()[page] || this.queue.includes(page)) return;
        this.queue.push(page);
        void this.drawQueue();
    }

    /** One page at a time, so a long PDF does not freeze the tab. */
    private async drawQueue(): Promise<void> {
        if (this.drawing) return;
        this.drawing = true;
        try {
            while (this.queue.length && this.pdf && !this.destroyed) {
                const page = this.queue.shift()!;
                try {
                    const drawing = await this.pdf.renderPage(page, THUMB_SIZE, 'image/jpeg');
                    if (this.destroyed) return;
                    const url = this.objectUrl(drawing.blob);
                    this.thumbs.update((thumbs) => ({ ...thumbs, [page]: url }));
                } catch (error) {
                    console.warn(`Could not draw page ${page}:`, error);
                }
            }
        } finally {
            this.drawing = false;
        }
    }

    async openPage(page: number): Promise<void> {
        if (!this.pdf || this.saving()) return;
        this.cropPage.set(page);
        this.cropUrl.set(null);
        this.cropRect.set(null);
        this.cropImageSize.set(null);
        this.ratio.set(this.initialRatio());
        this.step.set('crop');
        try {
            const drawing = await this.pdf.renderPage(page, CROP_VIEW_SIZE, 'image/jpeg');
            if (this.destroyed || this.cropPage() !== page) return;
            this.cropScale = drawing.scale;
            this.cropUrl.set(this.objectUrl(drawing.blob, 'crop'));
        } catch (error) {
            console.error(`Could not draw page ${page}:`, error);
            this.notify.error('admin.media.pdf.page_failed');
            this.backToPages();
        }
    }

    backToPages(): void {
        if (this.saving()) return;
        this.cropPage.set(null);
        this.cropUrl.set(null);
        this.cropRect.set(null);
        this.step.set('pages');
    }

    selectRatio(ratio: CropRatio): void {
        this.ratio.set(ratio);
    }

    onCropLoaded(size: CropImageSize): void {
        this.cropImageSize.set(size);
    }

    onCropRect(rect: CropRect): void {
        this.cropRect.set(rect);
    }

    onCropFailed(): void {
        this.notify.error('admin.media.pdf.page_failed');
        this.backToPages();
    }

    /**
     * Draws the framed part at the XL size, uploads it like any image (every
     * size, WebP when that setting is on) and adds it to My Uploads.
     */
    async save(): Promise<void> {
        const page = this.cropPage();
        const rect = this.cropRect();
        const pdf = this.pdf;
        if (!page || !rect || !pdf || this.saving()) return;

        this.saving.set(true);
        this.saveProgress.set(0);
        const source = this.source();
        try {
            const pdfRect = frameToPdfRect(rect, this.cropScale);
            const drawing = await pdf.renderRegion(page, pdfRect, saveScale(pdfRect, this.uploadSettings().maxSize), 'image/png');
            const file = new File([drawing.blob], `${source.title}-p${page}.png`, { type: 'image/png' });
            const uploaded = await this.fileUpload.uploadFile(file, this.uploadSettings(), (progress) => this.saveProgress.set(Math.round(progress)));
            const record: UploadedMedia & { source?: { fileId: string; page: number } } = {
                ...uploaded,
                title: this.i18n.translate('admin.media.pdf.image_title', { title: source.title, page }),
            };
            if (source.fileId) record.source = { fileId: source.fileId, page };
            let id: string;
            try {
                [id] = await firstValueFrom(this.mediaStore.addBatch([record]));
            } catch (error) {
                // An image no tab lists could never be found or deleted: take it back out.
                await this.fileUpload.removeStored(FileUploadService.storedPaths(uploaded));
                throw error;
            }
            if (this.destroyed) return;
            this.savedCount.update((n) => n + 1);
            this.saved.emit({ id, media: record });
            this.saving.set(false);
            this.notify.success('admin.media.pdf.saved');
            this.backToPages();
        } catch (error) {
            console.error('Could not save the image from the PDF:', error);
            if (this.destroyed) return;
            this.saving.set(false);
            this.notify.error('admin.media.pdf.save_failed', { reason: error instanceof Error ? error.message : '' });
        }
    }

    finish(): void {
        if (this.saving()) return;
        this.done.emit();
    }

    keep(): void {
        if (this.saving()) return;
        this.keepInFiles.emit();
    }

    /**
     * A blob URL, freed on teardown. The crop view's page is large (1600 px),
     * so only the latest is kept: opening another page frees the last one.
     */
    private objectUrl(blob: Blob, kind: 'thumb' | 'crop' = 'thumb'): string {
        const url = URL.createObjectURL(blob);
        if (kind === 'crop') {
            if (this.cropObjectUrl) URL.revokeObjectURL(this.cropObjectUrl);
            this.cropObjectUrl = url;
        } else {
            this.objectUrls.push(url);
        }
        return url;
    }

    private teardown(): void {
        this.destroyed = true;
        this.observer?.disconnect();
        this.queue = [];
        this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
        this.objectUrls = [];
        if (this.cropObjectUrl) URL.revokeObjectURL(this.cropObjectUrl);
        this.cropObjectUrl = null;
        void this.pdf?.destroy();
        this.pdf = null;
    }
}
