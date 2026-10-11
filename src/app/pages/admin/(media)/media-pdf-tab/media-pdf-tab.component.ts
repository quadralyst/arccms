import { Component, computed, ElementRef, inject, input, model, output, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { MediaUploadSettings } from '../../../../../shared/services/file-upload.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { CropRatio } from '../../../../../shared/utils/image-crop';
import { ImageSize } from '../../../../../shared/utils/image-sizes';
import { isPdfFile } from '../../../../../shared/utils/media-files';
import { filterBySearch } from '../../../../../shared/utils/media-search';
import { localPdfSource } from '../local-pdf-source';
import { IMediaFile } from '../media-files.model';
import { MediaFilesService } from '../media-files.service';
import { PdfImageSaved, PdfImageSource, PdfImageTakerComponent } from '../pdf-image-taker/pdf-image-taker.component';
import { PdfPickerMemory, PdfPlace } from '../pdf-picker-memory.service';

/** PDF cards shown before "Show more". */
const PAGE_SIZE = 24;

/**
 * From a PDF, the image pickers' tab for taking an image from a PDF and
 * inserting it (docs/features/media.html, From a PDF; PI3, PI-D1, PI-D2).
 * Lists the PDFs in Files, newest first and the one last used first of all,
 * under a card for choosing one from the computer (kept in Files, PI-D3).
 * Choosing one opens the page grid and crop step here, with Insert.
 */
@Component({
    selector: 'arc-media-pdf-tab',
    standalone: true,
    imports: [TranslocoPipe, PdfImageTakerComponent],
    templateUrl: './media-pdf-tab.component.html',
    styleUrl: './media-pdf-tab.component.scss',
})
export class MediaPdfTabComponent {
    private files = inject(MediaFilesService);
    private notify = inject(NotifyService);
    private memory = inject(PdfPickerMemory);
    private browser = isPlatformBrowser(inject(PLATFORM_ID));

    readonly uploadSettings = input.required<MediaUploadSettings>();
    readonly initialRatio = input<CropRatio>('free');
    readonly size = model<ImageSize>('m');
    readonly multiple = input(false);
    /** The remembered PDF and page to open on (PI-D8); null opens the list. */
    readonly resume = input<PdfPlace | null>(null);

    readonly inserted = output<PdfImageSaved[]>();

    readonly pdfs = signal<IMediaFile[]>([]);
    readonly loading = signal(true);
    readonly query = signal('');
    readonly limit = signal(PAGE_SIZE);
    readonly dragOver = signal(false);
    readonly source = signal<PdfImageSource | null>(null);
    readonly startPage = signal<number | null>(null);
    readonly startZoom = signal(1);
    /** The PDF last used in this tab, pinned first (PI-D2). */
    readonly lastUsedId = signal<string | null>(null);
    /** Every image taken in this picker visit, from any PDF, oldest first: a gallery inserts them all (PI-D18). */
    readonly taken = signal<PdfImageSaved[]>([]);
    /** Images taken before the open PDF was opened, for Insert's count. */
    readonly takenBefore = signal(0);

    private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
    /** Tells a PDF from the computer whether the taker opened it. */
    private settleLocal: ((ok: boolean) => void) | null = null;
    private loaded: Promise<void> = Promise.resolve();

    /** The cards: matching the search, else every PDF with the last used first. */
    readonly matching = computed(() => {
        const q = this.query().trim();
        if (q) return filterBySearch(this.pdfs(), q);
        const last = this.lastUsedId();
        const pdfs = this.pdfs();
        const pinned = last ? pdfs.find((f) => f.id === last) : undefined;
        return pinned ? [pinned, ...pdfs.filter((f) => f !== pinned)] : pdfs;
    });
    readonly shown = computed(() => this.matching().slice(0, this.limit()));
    readonly hasMore = computed(() => this.matching().length > this.limit());

    constructor() {
        this.lastUsedId.set(this.memory.place()?.fileId ?? null);
        if (this.browser) this.loaded = this.load();
    }

    ngOnInit(): void {
        const place = this.resume();
        if (place?.fileId) {
            this.openSource({
                title: place.title,
                fileId: place.fileId,
                key: place.fileId,
                load: (onProgress) => this.files.pdfBytes(place.fileId!, onProgress),
            }, place.page, place.zoom);
        }
    }

    private async load(): Promise<void> {
        this.loading.set(true);
        try {
            const all = await this.files.listAll();
            this.pdfs.set(all.filter((f) => f.type === 'pdf'));
        } catch (error) {
            console.error('Failed to load the PDFs:', error);
            this.notify.error('admin.media.pdf_tab.load_failed');
        } finally {
            this.loading.set(false);
        }
    }

    pages(file: IMediaFile): number {
        return file.pages ?? 0;
    }

    onSearch(event: Event): void {
        this.query.set((event.target as HTMLInputElement).value);
        this.limit.set(PAGE_SIZE);
    }

    clearSearch(): void {
        this.query.set('');
    }

    showMore(): void {
        this.limit.update((n) => n + PAGE_SIZE);
    }

    /** A PDF in Files. */
    openFile(file: IMediaFile): void {
        this.openSource({
            title: file.title,
            fileId: file.id,
            key: file.id,
            load: (onProgress) => this.files.pdfBytes(file.id, onProgress),
        });
    }

    choose(): void {
        this.fileInput()?.nativeElement.click();
    }

    onInput(event: Event): void {
        const field = event.target as HTMLInputElement;
        const picked = Array.from(field.files ?? []);
        field.value = '';
        this.takeLocal(picked);
    }

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.dragOver.set(true);
    }

    onDragLeave(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.dragOver.set(false);
    }

    onDrop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.dragOver.set(false);
        this.takeLocal(Array.from(event.dataTransfer?.files ?? []));
    }

    /**
     * A PDF from the computer (also one dropped on My Uploads, PI-D5): its
     * pages open at once, and it is kept in Files once it has opened.
     */
    openLocal(file: File): void {
        const local = localPdfSource(file, (f, onProgress) => this.files.keepPdf(f, onProgress), this.notify, (kept) => {
            this.lastUsedId.set(kept.id);
            this.loaded = this.load();
        });
        this.settleLocal = local.opened;
        this.openSource(local.source);
    }

    private takeLocal(picked: File[]): void {
        if (!picked.length) return;
        if (picked.length > 1) {
            this.notify.error('admin.media.pdf_tab.one_at_a_time');
            return;
        }
        if (!isPdfFile(picked[0])) {
            this.notify.error('admin.media.pdf_tab.not_pdf', { name: picked[0].name });
            return;
        }
        this.openLocal(picked[0]);
    }

    onSaved(saved: PdfImageSaved): void {
        this.taken.update((list) => [...list, saved]);
    }

    /** Insert: the image, or in a gallery every image taken in this visit, from whichever PDF. */
    onInserted(images: PdfImageSaved[]): void {
        this.inserted.emit(this.multiple() ? this.taken() : images);
    }

    private openSource(source: PdfImageSource, page: number | null = null, zoom = 1): void {
        this.takenBefore.set(this.taken().length);
        if (source.fileId) {
            this.settleLocal = null;
            this.lastUsedId.set(source.fileId);
        }
        this.startPage.set(page);
        this.startZoom.set(zoom);
        this.source.set(source);
    }

    onOpened(): void {
        this.settleLocal?.(true);
        this.settleLocal = null;
    }

    /**
     * The PDF could not be read or opened. A remembered or listed PDF that is
     * no longer in Files is forgotten and the list shown again (PI3).
     */
    async onFailed(): Promise<void> {
        this.settleLocal?.(false);
        this.settleLocal = null;
        const source = this.source();
        if (!source?.fileId) return;
        await this.loaded;
        if (this.source() !== source) return;
        // Only a PDF gone from Files is forgotten; one that could not be read
        // just now (offline) keeps its ticks and its place.
        if (!this.pdfs().some((f) => f.id === source.fileId)) {
            this.memory.forget(source.fileId);
            if (this.lastUsedId() === source.fileId) this.lastUsedId.set(null);
            this.notify.error('admin.media.pdf_tab.gone');
            this.toList();
        }
    }

    toList(): void {
        this.settleLocal = null;
        this.source.set(null);
        this.startPage.set(null);
        this.lastUsedId.set(this.memory.place()?.fileId ?? this.lastUsedId());
    }
}
