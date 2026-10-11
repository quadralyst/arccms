import { Injectable } from '@angular/core';
import { PdfRect } from '../../../../shared/utils/pdf-pages';

/** The PDF last worked on, and where in it. */
export interface PdfPlace {
    /** The library file's id, or a key for a PDF from the computer not yet kept. */
    key: string;
    /** The library file, once there is one. */
    fileId?: string;
    title: string;
    page: number;
    zoom: number;
}

/**
 * What the image pickers remember about PDFs while this browser tab is open
 * (docs/features/media.html, From a PDF; PI-D7, PI-D8): the PDF, page and
 * zoom last used, which parts of each page were taken, and whether the last
 * image chosen came from a PDF. Nothing is stored: a reload forgets it all,
 * by design. The PDF's bytes are MediaFilesService's (its recent list).
 */
@Injectable({ providedIn: 'root' })
export class PdfPickerMemory {
    private lastPlace: PdfPlace | null = null;
    private taken = new Map<string, Map<number, PdfRect[]>>();
    /** The last image chosen in an image picker came from From a PDF (PI-D8). */
    private fromPdf = false;

    /** The PDF, page and zoom last used, if any. */
    place(): PdfPlace | null {
        return this.lastPlace ? { ...this.lastPlace } : null;
    }

    remember(place: PdfPlace): void {
        this.lastPlace = { ...place };
    }

    /** A part of a page saved as an image. */
    markTaken(key: string, page: number, rect: PdfRect): void {
        const pages = this.taken.get(key) ?? new Map<number, PdfRect[]>();
        pages.set(page, [...(pages.get(page) ?? []), { ...rect }]);
        this.taken.set(key, pages);
    }

    /** The parts of `page` taken so far in this tab. */
    takenOn(key: string, page: number): PdfRect[] {
        return this.taken.get(key)?.get(page) ?? [];
    }

    /** A PDF from the computer is now in Files: carry what was remembered over to its id. */
    rekey(from: string, to: string): void {
        if (from === to) return;
        const pages = this.taken.get(from);
        if (pages) {
            const existing = this.taken.get(to);
            if (existing) {
                for (const [page, rects] of pages) existing.set(page, [...(existing.get(page) ?? []), ...rects]);
            } else {
                this.taken.set(to, pages);
            }
            this.taken.delete(from);
        }
        if (this.lastPlace?.key === from) this.lastPlace = { ...this.lastPlace, key: to, fileId: to };
    }

    /** A PDF that is gone (deleted, or no longer readable) is not offered again. */
    forget(key: string): void {
        this.taken.delete(key);
        if (this.lastPlace?.key === key) {
            this.lastPlace = null;
            this.fromPdf = false;
        }
    }

    /** Whether the next picker should open on the PDF (PI-D8). */
    lastChoiceFromPdf(): boolean {
        return this.fromPdf && !!this.lastPlace?.fileId;
    }

    /** An image chosen in a picker: from a PDF, or from anywhere else. */
    chose(fromPdf: boolean): void {
        this.fromPdf = fromPdf;
    }
}
