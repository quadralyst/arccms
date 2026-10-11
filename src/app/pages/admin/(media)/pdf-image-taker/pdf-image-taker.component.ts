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
    model,
    output,
    signal,
    Signal,
    untracked,
    viewChildren,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { CropImageSize, CropMark, ImageCropperComponent } from '../../../../../shared/components/image-cropper/image-cropper.component';
import { FileUploadService, MediaUploadSettings, UploadedMedia } from '../../../../../shared/services/file-upload.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { CROP_RATIOS, CropRatio, CropRect, cropRatioValue } from '../../../../../shared/utils/image-crop';
import { IMAGE_SIZE_LABELS, IMAGE_SIZES, ImageSize, imageSizeLimits } from '../../../../../shared/utils/image-sizes';
import { frameToPdfRect, openPdf, PdfDocument, PdfOpenError, PdfRect, saveScale, snapFrame } from '../../../../../shared/utils/pdf-pages';
import { MediaManagerStore } from '../media-manager.store';
import { PdfPickerMemory } from '../pdf-picker-memory.service';

/** A PDF from the computer being kept in Files while its pages are open (PI-D3, PI-D6). */
export interface PdfStoring {
    /** The library file's id once kept; null when it could not be kept. */
    done: Promise<string | null>;
    /** 0 to 100. */
    percent: Signal<number>;
}

/** Where the PDF comes from: a file on the admin's computer, or one in the library. */
export interface PdfImageSource {
    /** The PDF's title; images are named after it ("Brochure, page 3"). */
    title: string;
    /** The library file, when it is one; saved images record it (MF4). */
    fileId?: string;
    /** What the picker remembers it by: the file's id, or a key for a PDF from the computer. */
    key?: string;
    /** The PDF's bytes. Progress, when reading takes a while, is 0 to 100. */
    load: (onProgress: (percent: number) => void) => Promise<Blob>;
    /** A PDF from the computer being kept in Files alongside (PI-D3). */
    storing?: PdfStoring;
}

/** An image saved from a page, as the media page selects it. */
export interface PdfImageSaved {
    id: string;
    media: UploadedMedia;
}

/** The longest side of a page in the grid. */
const THUMB_SIZE = 240;
/** The longest side of the page the crop frame is placed on, at fit. */
const CROP_VIEW_SIZE = 1600;
/** The most detail the crop view is drawn with when zoomed: twice the fit view (PI-D14). */
const CROP_VIEW_MAX = 3200;
/** The zoom steps of the minus and plus buttons; gestures can stop in between. */
export const PDF_ZOOM_LEVELS = [1, 1.5, 2, 3, 4] as const;
const MAX_ZOOM = PDF_ZOOM_LEVELS[PDF_ZOOM_LEVELS.length - 1];

type Step = 'loading' | 'pages' | 'crop' | 'error';

/** The longest side to draw the crop view at for `zoom`. */
export function cropViewSize(zoom: number): number {
    if (zoom >= 2) return CROP_VIEW_MAX;
    if (zoom >= 1.5) return 2400;
    return CROP_VIEW_SIZE;
}

/** Whether a saved part of a page covers most of `picture`: that picture was taken. */
export function coversPicture(taken: PdfRect, picture: PdfRect): boolean {
    const w = Math.min(taken.x + taken.width, picture.x + picture.width) - Math.max(taken.x, picture.x);
    const h = Math.min(taken.y + taken.height, picture.y + picture.height) - Math.max(taken.y, picture.y);
    return w > 0 && h > 0 && w * h >= 0.5 * picture.width * picture.height;
}

/**
 * Take an image from a PDF (docs/features/media.html, Take an image from a
 * PDF; MF3, MF4, PI2, PI4). The pages show as a grid, drawn as they scroll
 * into view; clicking one opens the crop step admins know from cropping an
 * upload, with the pictures on the page outlined and the frame on the first
 * one not yet taken. The page can be zoomed and paged through. Save draws
 * only the framed part again, at the XL size (MF-D14), and stores it as a
 * normal upload in My Uploads. In a picker, Insert saves and hands the image
 * back at once (PI-D16). The PDF itself is never changed.
 */
@Component({
    selector: 'arc-pdf-image-taker',
    standalone: true,
    imports: [TranslocoPipe, ImageCropperComponent, DecimalPipe],
    templateUrl: './pdf-image-taker.component.html',
    styleUrl: './pdf-image-taker.component.scss',
})
export class PdfImageTakerComponent {
    private fileUpload = inject(FileUploadService);
    private mediaStore = inject(MediaManagerStore);
    private notify = inject(NotifyService);
    private i18n = inject(TranslocoService);
    private injector = inject(Injector);
    private memory = inject(PdfPickerMemory);

    readonly source = input.required<PdfImageSource>();
    readonly uploadSettings = input.required<MediaUploadSettings>();
    /** The ratio the frame opens with: the caller's slot (MediaDialogData.cropRatio). */
    readonly initialRatio = input<CropRatio>('free');
    /**
     * The size the picker inserts at (PI-D17), shown as chips in the crop
     * step and used for the "too small" note. Null on the Media page, which
     * inserts nothing.
     */
    readonly size = model<ImageSize | null>(null);
    /** In a picker: Insert hands the image back (PI-D16). */
    readonly insertable = input(false);
    /** The picker takes several images: Insert hands back every one taken in this visit (PI-D18). */
    readonly multiple = input(false);
    /** Open straight on this page's crop step (the remembered page, PI-D8). */
    readonly startPage = input<number | null>(null);
    readonly startZoom = input(1);
    /** Inside From a PDF: "All PDFs" goes back to the list, instead of Done. */
    readonly inList = input(false);

    readonly saved = output<PdfImageSaved>();
    readonly done = output<void>();
    /** Insert: the images to hand back, newest last. */
    readonly inserted = output<PdfImageSaved[]>();
    /** "All PDFs" (inside From a PDF). */
    readonly back = output<void>();
    /** The PDF opened: a PDF from the computer may now be kept in Files (PI-D3). */
    readonly opened = output<void>();
    /** The PDF could not be read or opened: the picker forgets it (PI3). */
    readonly failed = output<void>();

    readonly cropRatios = CROP_RATIOS;
    readonly imageSizes = IMAGE_SIZES;
    readonly imageSizeLabels = IMAGE_SIZE_LABELS;
    readonly zoomLevels = PDF_ZOOM_LEVELS;
    readonly step = signal<Step>('loading');
    readonly loadPercent = signal<number | null>(null);
    readonly problem = signal<'locked' | 'unreadable' | 'read_failed'>('unreadable');
    readonly pageCount = signal(0);
    readonly pageNumbers = computed(() => Array.from({ length: this.pageCount() }, (_, i) => i + 1));
    /** Drawn page thumbnails by page number. */
    readonly thumbs = signal<Record<number, string>>({});
    /** The images taken in this visit, oldest first. */
    readonly takenHere = signal<PdfImageSaved[]>([]);
    readonly savedCount = computed(() => this.takenHere().length);

    readonly cropPage = signal<number | null>(null);
    readonly cropUrl = signal<string | null>(null);
    readonly ratio = signal<CropRatio>('free');
    readonly cropRect = signal<CropRect | null>(null);
    readonly cropImageSize = signal<CropImageSize | null>(null);
    readonly saving = signal(false);
    readonly saveProgress = signal(0);
    /** Waiting for the PDF from the computer to be kept in Files before saving (PI-D6). */
    readonly waitingForStore = signal(false);
    readonly zoom = signal(1);
    /** The frame the cropper is told to place, in its image's pixels. */
    readonly placedFrame = signal<CropRect | null>(null);
    /** The pictures found on the page in the crop step, in page points (PI-D10). */
    readonly pictures = signal<PdfRect[]>([]);
    /** Bumped when a part is taken, so the ticks redraw. */
    private readonly takenVersion = signal(0);
    readonly alt = signal('');
    /** The library file, once known: the source's, or the stored PDF's (PI-D6). */
    readonly storedId = signal<string | null>(null);
    /** The PDF from the computer could not be kept in Files. */
    readonly storeFailed = signal(false);

    private readonly tiles = viewChildren<ElementRef<HTMLElement>>('tile');
    private pdf: PdfDocument | null = null;
    /** The scale the crop view's image was drawn at, in pixels per PDF point. */
    private cropScale = 1;
    /** The scale of the drawing being loaded into the cropper. */
    private pendingScale = 1;
    /** The detail the crop view was drawn with (longest side). */
    private drawnSize = 0;
    private observer: IntersectionObserver | null = null;
    private queue: number[] = [];
    private drawing = false;
    private destroyed = false;
    private objectUrls: string[] = [];
    private cropObjectUrl: string | null = null;
    /** Images taken from each page in this visit, for numbering their titles. */
    private takenPerPage = new Map<number, number>();

    readonly fileId = computed(() => this.source().fileId ?? this.storedId() ?? undefined);
    /** What the memory knows this PDF by. */
    private key(): string {
        const source = this.source();
        return this.fileId() ?? source.key ?? source.title;
    }

    readonly ratioNumber = computed(() => {
        const size = this.cropImageSize();
        if (this.ratio() === 'original') return size ? size.width / size.height : null;
        return cropRatioValue(this.ratio(), 1, 1);
    });

    /** The outlines over the page: the pictures found, with a tick on those taken (PI-D9). */
    readonly marks = computed<CropMark[]>(() => {
        this.takenVersion();
        const page = this.cropPage();
        const size = this.cropImageSize();
        if (!page || !size) return [];
        const pictures = this.pictures();
        const taken = this.memory.takenOn(this.key(), page);
        return pictures.map((picture, i) => ({
            rect: this.toImage(picture),
            label: this.i18n.translate('admin.media.pdf.picture_label', { n: i + 1, count: pictures.length }),
            taken: taken.some((t) => coversPicture(t, picture)),
        }));
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

    /** The size the picker inserts at, for the "too small" note; none on the Media page. */
    readonly sizeLimit = computed(() => {
        const size = this.size();
        if (!size) return null;
        return { label: IMAGE_SIZE_LABELS[size], limit: imageSizeLimits(this.uploadSettings().maxSize)[size] };
    });

    readonly tooSmall = computed(() => {
        const result = this.resultSize();
        const limit = this.sizeLimit();
        return !!result && !!limit && Math.max(result.width, result.height) < limit.limit;
    });

    /** The line under the page saying where the image goes and what happens to the PDF. */
    readonly storeNote = computed(() => {
        const source = this.source();
        if (source.fileId) return 'admin.media.pdf.note_library';
        if (!source.storing) return 'admin.media.pdf.note_local';
        if (this.storedId()) return 'admin.media.pdf.note_kept';
        return this.storeFailed() ? 'admin.media.pdf.note_not_kept' : 'admin.media.pdf.note_keeping';
    });

    /** The busy button's words: waiting for the PDF to be kept, then saving. */
    readonly savingLabel = computed(() => this.waitingForStore()
        ? this.i18n.translate('admin.media.pdf.keeping', { percent: Math.round(this.source().storing?.percent() ?? 0) })
        : this.i18n.translate('admin.media.crop.saving', { percent: this.saveProgress() }));

    /** How many images Insert hands back (PI-D18). */
    readonly insertCount = computed(() => (this.multiple() ? this.takenHere().length + 1 : 1));

    constructor() {
        const destroyRef = inject(DestroyRef);
        destroyRef.onDestroy(() => this.teardown());

        effect(() => {
            const source = this.source();
            untracked(() => void this.open(source));
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
        this.storedId.set(null);
        this.storeFailed.set(false);
        if (source.storing) void this.followStoring(source);
        let bytes: Blob;
        try {
            bytes = await source.load((percent) => this.loadPercent.set(Math.round(percent)));
        } catch (error) {
            console.error('Could not read the PDF:', error);
            if (this.destroyed) return;
            this.problem.set('read_failed');
            this.step.set('error');
            this.failed.emit();
            return;
        }
        try {
            this.pdf = await openPdf(bytes);
        } catch (error) {
            if (this.destroyed) return;
            this.problem.set(error instanceof PdfOpenError ? error.problem : 'unreadable');
            this.step.set('error');
            this.failed.emit();
            return;
        }
        if (this.destroyed) {
            void this.pdf.destroy();
            return;
        }
        this.pageCount.set(this.pdf.pageCount);
        this.opened.emit();
        this.zoom.set(Math.min(MAX_ZOOM, Math.max(1, this.startZoom())));
        const start = this.startPage();
        if (start && start >= 1 && start <= this.pdf.pageCount) {
            void this.openPage(start);
            return;
        }
        this.step.set('pages');
    }

    /** A PDF from the computer: once kept in Files, its images record it and the memory knows its id. */
    private async followStoring(source: PdfImageSource): Promise<void> {
        const id = await source.storing!.done.catch(() => null);
        if (this.destroyed || this.source() !== source) return;
        if (!id) {
            this.storeFailed.set(true);
            return;
        }
        const before = source.key ?? source.title;
        this.storedId.set(id);
        this.memory.rekey(before, id);
        this.takenVersion.update((n) => n + 1);
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
        if (this.thumbs()[page]) return;
        if (!this.queue.includes(page)) this.queue.push(page);
        void this.drawQueue();
    }

    /**
     * One page at a time, so a long PDF does not freeze the tab. Paused while
     * a page is open to crop: that page draws first, and the grid carries on
     * when it is shown again.
     */
    private async drawQueue(): Promise<void> {
        if (this.drawing) return;
        this.drawing = true;
        try {
            while (this.queue.length && this.pdf && !this.destroyed && this.step() === 'pages') {
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

    /**
     * The crop step for `page`: drawn for the current zoom, its pictures
     * found, the frame on the first one not yet taken (PI-D9).
     */
    async openPage(page: number): Promise<void> {
        if (!this.pdf || this.saving()) return;
        const keepRatio = this.step() === 'crop';
        this.cropPage.set(page);
        this.cropUrl.set(null);
        this.cropRect.set(null);
        this.cropImageSize.set(null);
        this.pictures.set([]);
        this.placedFrame.set(null);
        if (!keepRatio) this.ratio.set(this.initialRatio());
        this.step.set('crop');
        this.rememberPlace();
        try {
            const size = cropViewSize(this.zoom());
            const [drawing, pictures] = await Promise.all([
                this.pdf.renderPage(page, size, 'image/jpeg'),
                this.pdf.findPictures(page),
            ]);
            if (this.destroyed || this.cropPage() !== page) return;
            this.drawnSize = size;
            this.pendingScale = drawing.scale;
            this.cropScale = drawing.scale;
            this.pictures.set(pictures);
            const next = this.firstUntaken(page, pictures);
            // Original is the page's shape, which means nothing for one picture.
            if (next && this.ratio() === 'original') this.ratio.set('free');
            this.placedFrame.set(next ? this.snapped(next, drawing) : null);
            this.cropUrl.set(this.objectUrl(drawing.blob, 'crop'));
        } catch (error) {
            console.error(`Could not draw page ${page}:`, error);
            this.notify.error('admin.media.pdf.page_failed');
            this.backToPages();
        }
    }

    /** Previous or next page, or a typed number (PI-D15). */
    goToPage(page: number): void {
        const count = this.pageCount();
        const target = Math.round(Number(page));
        if (!Number.isFinite(target) || target < 1 || target > count || target === this.cropPage()) return;
        void this.openPage(target);
    }

    /** The page number box: a number out of range goes back to the page shown. */
    onPageInput(event: Event): void {
        const field = event.target as HTMLInputElement;
        const target = Math.round(Number(field.value));
        if (Number.isFinite(target) && target >= 1 && target <= this.pageCount()) this.goToPage(target);
        else field.value = String(this.cropPage() ?? '');
    }

    /** Page Up and Page Down move between pages; typing in a box is left alone. */
    onCropKey(event: KeyboardEvent): void {
        const page = this.cropPage();
        if (!page || (event.target as HTMLElement)?.tagName === 'INPUT') return;
        if (event.key === 'PageDown') {
            event.preventDefault();
            this.goToPage(page + 1);
        } else if (event.key === 'PageUp') {
            event.preventDefault();
            this.goToPage(page - 1);
        }
    }

    backToPages(): void {
        if (this.saving()) return;
        this.cropPage.set(null);
        this.cropUrl.set(null);
        this.cropRect.set(null);
        this.pictures.set([]);
        this.placedFrame.set(null);
        this.step.set('pages');
    }

    selectRatio(ratio: CropRatio): void {
        const on = this.currentPicture();
        this.ratio.set(ratio);
        const size = this.cropImageSize();
        // On a picture: the new shape stays on it (PI-D12); else, or for the
        // page's own shape, a fresh centred frame.
        this.placedFrame.set(on && size && ratio !== 'original' ? this.toImage(snapFrame(on, this.ratioValueFor(ratio, size))) : null);
    }

    /** A picture's outline clicked: the frame takes its edges (PI-D12). */
    pickPicture(index: number): void {
        const picture = this.pictures()[index];
        const size = this.cropImageSize();
        if (!picture || !size || this.saving()) return;
        // Original is the page's shape, which means nothing for one picture.
        if (this.ratio() === 'original') this.ratio.set('free');
        this.placedFrame.set(this.toImage(snapFrame(picture, this.ratioValueFor(this.ratio(), size))));
    }

    zoomIn(): void {
        const next = PDF_ZOOM_LEVELS.find((level) => level > this.zoom() + 0.01);
        if (next) this.setZoom(next);
    }

    zoomOut(): void {
        const next = [...PDF_ZOOM_LEVELS].reverse().find((level) => level < this.zoom() - 0.01);
        if (next) this.setZoom(next);
    }

    /**
     * A new zoom (PI-D14), kept between 1 and 4. Past what the page was drawn
     * with, it is drawn again with more detail; the frame stays put.
     */
    setZoom(zoom: number): void {
        const next = Math.min(MAX_ZOOM, Math.max(1, Math.round(zoom * 100) / 100));
        if (next === this.zoom()) return;
        this.zoom.set(next);
        this.rememberPlace();
        const page = this.cropPage();
        const needed = cropViewSize(next);
        if (page && this.step() === 'crop' && needed > this.drawnSize) void this.redraw(page, needed);
    }

    /** The same page with more detail; the frame is carried over in page points. */
    private async redraw(page: number, size: number): Promise<void> {
        if (!this.pdf || this.saving()) return;
        this.drawnSize = size;
        try {
            const drawing = await this.pdf.renderPage(page, size, 'image/jpeg');
            // Gone, saving, or overtaken by a later zoom asking for more.
            if (this.destroyed || this.cropPage() !== page || this.saving() || this.drawnSize !== size) return;
            // The frame as reported, or, when the last drawing has not loaded
            // yet (two quick zooms), the frame it was about to show.
            const rect = this.cropRect();
            const placed = this.placedFrame();
            const kept = rect ? frameToPdfRect(rect, this.cropScale) : placed ? frameToPdfRect(placed, this.pendingScale) : null;
            this.pendingScale = drawing.scale;
            this.placedFrame.set(kept ? this.scaleRect(kept, drawing.scale) : null);
            this.cropRect.set(null);
            this.cropUrl.set(this.objectUrl(drawing.blob, 'crop'));
        } catch (error) {
            // The page as drawn stays; it is only less sharp when zoomed.
            console.warn(`Could not draw page ${page} with more detail:`, error);
        }
    }

    onCropLoaded(size: CropImageSize): void {
        this.cropScale = this.pendingScale;
        this.cropImageSize.set(size);
    }

    onCropRect(rect: CropRect): void {
        this.cropRect.set(rect);
    }

    onCropFailed(): void {
        this.notify.error('admin.media.pdf.page_failed');
        this.backToPages();
    }

    selectSize(size: ImageSize): void {
        this.size.set(size);
    }

    onAlt(event: Event): void {
        this.alt.set((event.target as HTMLInputElement).value);
    }

    /** Save, take another: saves, then moves the frame to the next picture not taken. */
    async save(): Promise<void> {
        const saved = await this.store();
        if (!saved || this.destroyed) return;
        this.notify.success('admin.media.pdf.saved');
        const page = this.cropPage();
        const size = this.cropImageSize();
        const next = page ? this.firstUntaken(page, this.pictures()) : null;
        if (next && size) this.placedFrame.set(this.toImage(snapFrame(next, this.ratioValueFor(this.ratio(), size))));
    }

    /** Insert: saves, then hands the image back (with every one taken here, for a gallery). */
    async insert(): Promise<void> {
        const saved = await this.store();
        if (!saved || this.destroyed) return;
        this.inserted.emit(this.multiple() ? this.takenHere() : [saved]);
    }

    /**
     * Draws the framed part at the XL size, uploads it like any image (every
     * size, WebP when that setting is on) and adds it to My Uploads. A PDF
     * from the computer still being kept in Files is waited for, so the image
     * records where it came from (PI-D6).
     */
    private async store(): Promise<PdfImageSaved | null> {
        const page = this.cropPage();
        const rect = this.cropRect();
        const pdf = this.pdf;
        if (!page || !rect || !pdf || this.saving()) return null;

        this.saving.set(true);
        this.saveProgress.set(0);
        const source = this.source();
        try {
            if (source.storing && !this.storedId() && !this.storeFailed()) {
                this.waitingForStore.set(true);
                await source.storing.done.catch(() => null);
                // followStoring sets the id (or the failure) from the same promise.
                await Promise.resolve();
                this.waitingForStore.set(false);
            }
            const pdfRect = frameToPdfRect(rect, this.cropScale);
            const drawing = await pdf.renderRegion(page, pdfRect, saveScale(pdfRect, this.uploadSettings().maxSize), 'image/png');
            const file = new File([drawing.blob], `${source.title}-p${page}.png`, { type: 'image/png' });
            const uploaded = await this.fileUpload.uploadFile(file, this.uploadSettings(), (progress) => this.saveProgress.set(Math.round(progress)));
            const count = (this.takenPerPage.get(page) ?? 0) + 1;
            const title = this.i18n.translate('admin.media.pdf.image_title', { title: source.title, page });
            const record: UploadedMedia & { source?: { fileId: string; page: number }; alt?: string } = {
                ...uploaded,
                title: count > 1 ? `${title} (${count})` : title,
            };
            const alt = this.alt().trim();
            if (alt) record.alt = alt;
            const fileId = this.fileId();
            if (fileId) record.source = { fileId, page };
            let id: string;
            try {
                [id] = await firstValueFrom(this.mediaStore.addBatch([record]));
            } catch (error) {
                // An image no tab lists could never be found or deleted: take it back out.
                await this.fileUpload.removeStored(FileUploadService.storedPaths(uploaded));
                throw error;
            }
            if (this.destroyed) return null;
            const saved: PdfImageSaved = { id, media: record };
            this.takenPerPage.set(page, count);
            this.memory.markTaken(this.key(), page, pdfRect);
            this.takenVersion.update((n) => n + 1);
            this.takenHere.update((list) => [...list, saved]);
            this.alt.set('');
            this.saved.emit(saved);
            this.saving.set(false);
            return saved;
        } catch (error) {
            console.error('Could not save the image from the PDF:', error);
            if (this.destroyed) return null;
            this.saving.set(false);
            this.waitingForStore.set(false);
            this.notify.error('admin.media.pdf.save_failed', { reason: error instanceof Error ? error.message : '' });
            return null;
        }
    }

    finish(): void {
        if (this.saving()) return;
        this.done.emit();
    }

    toList(): void {
        if (this.saving()) return;
        this.back.emit();
    }

    /** The first picture on `page` not yet taken, in reading order (PI-D9). */
    private firstUntaken(page: number, pictures: PdfRect[]): PdfRect | null {
        const taken = this.memory.takenOn(this.key(), page);
        return pictures.find((picture) => !taken.some((t) => coversPicture(t, picture))) ?? null;
    }

    /** The picture the frame is on, if any. */
    private currentPicture(): PdfRect | null {
        const rect = this.cropRect();
        const size = this.cropImageSize();
        if (!rect || !size) return null;
        const marks = this.marks();
        const index = marks.findIndex((mark) =>
            Math.abs(mark.rect.x - rect.x) <= 0.01 * size.width
            && Math.abs(mark.rect.y - rect.y) <= 0.01 * size.height
            && Math.abs(mark.rect.x + mark.rect.width - rect.x - rect.width) <= 0.01 * size.width
            && Math.abs(mark.rect.y + mark.rect.height - rect.y - rect.height) <= 0.01 * size.height);
        return index >= 0 ? this.pictures()[index] : null;
    }

    /** A picture's frame on a page just drawn, before the cropper reports its size. */
    private snapped(picture: PdfRect, drawing: { width: number; height: number; scale: number }): CropRect {
        const frame = snapFrame(picture, this.ratioValueFor(this.ratio(), drawing));
        return this.scaleRect(frame, drawing.scale);
    }

    private ratioValueFor(ratio: CropRatio, size: { width: number; height: number }): number | null {
        return cropRatioValue(ratio, size.width, size.height);
    }

    /** Page points to the crop view's pixels. */
    private toImage(rect: PdfRect): CropRect {
        return this.scaleRect(rect, this.cropScale);
    }

    private scaleRect(rect: PdfRect, scale: number): CropRect {
        return { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale };
    }

    private rememberPlace(): void {
        const page = this.cropPage();
        if (!page) return;
        const source = this.source();
        const fileId = this.fileId();
        this.memory.remember({ key: this.key(), ...(fileId ? { fileId } : {}), title: source.title, page, zoom: this.zoom() });
    }

    /**
     * A blob URL, freed on teardown. The crop view's page is large (up to
     * 3200 px), so only the latest is kept: opening another page frees the last.
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
