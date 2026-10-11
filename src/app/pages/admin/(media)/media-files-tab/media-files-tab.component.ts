import { Component, computed, ElementRef, inject, input, output, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DocumentSnapshot } from '@angular/fire/firestore';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { FileUploadService, MediaFileUploadError, UploadedDocument } from '../../../../../shared/services/file-upload.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { ALLOWED_FILE_ACCEPT, fileMeta, formatBytes, MEDIA_FILE_TYPE_ICONS } from '../../../../../shared/utils/media-files';
import { filterBySearch } from '../../../../../shared/utils/media-search';
import { IMediaFile } from '../media-files.model';
import { MediaFilesService } from '../media-files.service';

const PAGE_SIZE = 20;

/**
 * The media library's Files tab (docs/features/media.html, Files): an upload
 * card, one card per document, a search box and paging. Selecting a card is
 * the page's business (the side panel); this keeps the list.
 */
@Component({
    selector: 'arc-media-files-tab',
    standalone: true,
    imports: [TranslocoPipe, MatPaginatorModule, MatProgressSpinnerModule],
    templateUrl: './media-files-tab.component.html',
    styleUrl: './media-files-tab.component.scss',
})
export class MediaFilesTabComponent {
    private files = inject(MediaFilesService);
    private fileUpload = inject(FileUploadService);
    private notify = inject(NotifyService);
    private browser = isPlatformBrowser(inject(PLATFORM_ID));

    readonly selectedId = input<string | null>(null);
    /** In multi-select, the files picked so far, in order. */
    readonly pickedIds = input<string[]>([]);
    readonly multiple = input(false);
    /** Drop zones and buttons are off while the page is busy elsewhere (a crop saving). */
    readonly disabled = input(false);

    readonly selected = output<IMediaFile>();

    readonly accept = ALLOWED_FILE_ACCEPT;
    readonly icons = MEDIA_FILE_TYPE_ICONS;
    readonly items = signal<IMediaFile[]>([]);
    readonly totalItems = signal(0);
    readonly pageIndex = signal(0);
    readonly loading = signal(true);
    readonly query = signal('');
    /** Every file's details, loaded on the first search of this visit. */
    readonly allItems = signal<IMediaFile[] | null>(null);
    readonly searching = computed(() => this.query().trim().length > 0);
    readonly shown = computed(() => {
        if (!this.searching()) return this.items();
        return filterBySearch(this.allItems() ?? [], this.query());
    });

    readonly uploading = signal(false);
    readonly uploadCurrent = signal(0);
    readonly uploadTotal = signal(0);
    readonly uploadPercent = signal(0);
    readonly dragOver = signal(false);

    private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
    /** Last document of each page shown so far, to page back. */
    private pageEnds: (DocumentSnapshot | undefined)[] = [];

    constructor() {
        if (this.browser) void this.loadPage(0);
    }

    meta(file: IMediaFile): string {
        return fileMeta(file);
    }

    isPicked(file: IMediaFile): boolean {
        return this.pickedIds().includes(file.id);
    }

    pickIndex(file: IMediaFile): number {
        return this.pickedIds().indexOf(file.id) + 1;
    }

    choose(file: IMediaFile): void {
        this.selected.emit(file);
    }

    openPicker(): void {
        if (this.uploading() || this.disabled()) return;
        this.fileInput()?.nativeElement.click();
    }

    onInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        const picked = Array.from(input.files ?? []);
        input.value = '';
        void this.upload(picked);
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
        void this.upload(Array.from(event.dataTransfer?.files ?? []));
    }

    /**
     * Uploads documents one at a time, then adds every one that made it to
     * the library and shows the first page. A file the library does not take
     * is reported by name and skipped; the rest still go up. One upload
     * alone is selected once it is in.
     */
    async upload(picked: File[]): Promise<void> {
        if (!picked.length || this.uploading() || this.disabled()) return;
        this.uploading.set(true);
        this.uploadTotal.set(picked.length);
        this.uploadCurrent.set(0);

        const done: UploadedDocument[] = [];
        const sources: File[] = [];
        for (const file of picked) {
            this.uploadCurrent.update((n) => n + 1);
            this.uploadPercent.set(0);
            try {
                done.push(await this.fileUpload.uploadDocument(file, (pct) => this.uploadPercent.set(Math.round(pct))));
                sources.push(file);
            } catch (error) {
                this.reportUploadError(file, error);
            }
        }

        let ids: string[] = [];
        if (done.length) {
            try {
                ids = await firstValueFrom(this.files.addBatch(done));
                ids.forEach((id, i) => {
                    if (done[i].type === 'pdf') this.files.rememberBytes(id, sources[i]);
                });
            } catch (error) {
                console.error('Failed to save file details:', error);
                this.notify.error('admin.media.files.metadata_failed');
                // Unlisted files could never be found or deleted: take them back out.
                await this.fileUpload.removeStored(done.flatMap((d) => FileUploadService.storedPaths(d)));
            }
        }

        this.uploading.set(false);
        this.allItems.set(null);
        this.query.set('');
        await this.loadPage(0);
        if (ids.length === 1) {
            const fresh = this.items().find((f) => f.id === ids[0]);
            if (fresh) this.selected.emit(fresh);
        }
    }

    private reportUploadError(file: File, error: unknown): void {
        const name = file.name;
        if (error instanceof MediaFileUploadError) {
            if (error.problem === 'type') this.notify.error('admin.media.files.error_type', { name });
            else this.notify.error('admin.media.files.error_size', { name, size: formatBytes(error.bytes) });
            return;
        }
        console.error(`Failed to upload ${file.name}:`, error);
        this.notify.error('admin.media.files.upload_failed', { name });
    }

    async onSearch(value: string): Promise<void> {
        this.query.set(value);
        if (!value.trim() || this.allItems()) return;
        try {
            this.allItems.set(await this.files.listAll());
        } catch (error) {
            console.error('Failed to load files for search:', error);
            this.notify.error('admin.media.files.load_failed');
            this.allItems.set([]);
        }
    }

    clearSearch(): void {
        this.query.set('');
    }

    onPage(event: PageEvent): void {
        void this.loadPage(event.pageIndex);
    }

    /** Reloads the page shown, after a file was edited or deleted elsewhere. */
    async refresh(): Promise<void> {
        this.allItems.set(null);
        if (this.searching()) await this.onSearch(this.query());
        await this.loadPage(Math.min(this.pageIndex(), this.pageEnds.length));
    }

    /** A file the panel changed, put in place without a reload. */
    replace(file: IMediaFile): void {
        const swap = (list: IMediaFile[]) => list.map((f) => (f.id === file.id ? file : f));
        this.items.update(swap);
        this.allItems.update((all) => (all ? swap(all) : all));
    }

    private async loadPage(index: number): Promise<void> {
        this.loading.set(true);
        try {
            if (index === 0) this.pageEnds = [];
            const after = index > 0 ? this.pageEnds[index - 1] : undefined;
            const page = await this.files.listPage(PAGE_SIZE, after);
            // Past the end after a delete emptied the last page: show the one before.
            if (!page.items.length && index > 0) {
                this.pageEnds = this.pageEnds.slice(0, index - 1);
                return this.loadPage(index - 1);
            }
            this.pageEnds[index] = page.lastVisible;
            this.items.set(page.items);
            this.totalItems.set(page.totalItems);
            this.pageIndex.set(index);
        } catch (error) {
            console.error('Failed to load files:', error);
            this.notify.error('admin.media.files.load_failed');
        } finally {
            this.loading.set(false);
        }
    }
}
