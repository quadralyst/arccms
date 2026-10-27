import { inject, Injectable, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
    collection,
    deleteDoc,
    doc,
    DocumentSnapshot,
    Firestore,
    getCountFromServer,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    startAfter,
    updateDoc,
} from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { deleteObject, ref, updateMetadata } from '@angular/fire/storage';
import { ArcStorage } from '../../../core/config/arc-storage';
import { firstValueFrom } from 'rxjs';
import { arcCallable } from '../../../core/config/arc-functions';
import { DbService } from '../../../../shared/services/db.service';
import { FileUploadService } from '../../../../shared/services/file-upload.service';
import { allowedFileOf, contentDispositionFor, isSameUpload } from '../../../../shared/utils/media-files';
import { IMediaFile } from './media-files.model';

/** One page of the Files tab. */
export interface MediaFilePage {
    items: IMediaFile[];
    totalItems: number;
    lastVisible?: DocumentSnapshot;
}

/** The fields the preview panel edits. */
export interface MediaFileDetails {
    title?: string;
    notes?: string;
}

/**
 * The `mediaFiles` collection: documents in the media library
 * (docs/features/media.html, Files). Uploading is FileUploadService's job;
 * this lists, edits and deletes.
 */
@Injectable({ providedIn: 'root' })
export class MediaFilesService extends DbService<IMediaFile> {
    private db = inject(Firestore);
    private arcStorage = inject(ArcStorage);
    private platform = inject(PLATFORM_ID);
    private functions = inject(Functions);
    private fileUpload = inject(FileUploadService);
    private readMediaFileFn = arcCallable<{ fileId: string; offset: number }, { data: string; offset: number; total: number }>(this.functions, 'readMediaFile');

    constructor() {
        super('mediaFiles');
    }

    /** One page, newest first. Empty on the server: the library is a browser tool. */
    async listPage(pageSize: number, after?: DocumentSnapshot): Promise<MediaFilePage> {
        if (!isPlatformBrowser(this.platform)) return { items: [], totalItems: 0 };
        return runInInjectionContext(this.injector, async () => {
            const files = collection(this.db, 'mediaFiles');
            const q = after
                ? query(files, orderBy('uploadTime', 'desc'), startAfter(after), limit(pageSize))
                : query(files, orderBy('uploadTime', 'desc'), limit(pageSize));
            const [snapshot, count] = await Promise.all([getDocs(q), getCountFromServer(files)]);
            return {
                items: snapshot.docs.map((d) => toMediaFile(d.id, d.data())),
                totalItems: count.data().count,
                lastVisible: snapshot.docs[snapshot.docs.length - 1],
            };
        });
    }

    /** Every file, newest first, for the search box (MF-D23). */
    async listAll(): Promise<IMediaFile[]> {
        if (!isPlatformBrowser(this.platform)) return [];
        return runInInjectionContext(this.injector, async () => {
            const snapshot = await getDocs(query(collection(this.db, 'mediaFiles'), orderBy('uploadTime', 'desc')));
            return snapshot.docs.map((d) => toMediaFile(d.id, d.data()));
        });
    }

    /**
     * PDFs uploaded or read in this visit, by id, most recently used last:
     * Take an image uses these instead of reading the file back (MF-D16,
     * PI-D7). Kept for the last few only, since a PDF can be 20 MB.
     */
    private recent = new Map<string, Blob>();

    rememberBytes(id: string, bytes: Blob): void {
        this.recent.delete(id);
        this.recent.set(id, bytes);
        while (this.recent.size > 3) this.recent.delete(this.recent.keys().next().value!);
    }

    /**
     * The bytes of a library PDF: from this visit's uploads or reads when
     * there, else read in parts and kept, so a PDF is read once per visit
     * (PI-D7), not once per image picker opened.
     */
    async pdfBytes(fileId: string, onProgress: (percent: number) => void = () => {}): Promise<Blob> {
        const local = this.recent.get(fileId);
        if (local) {
            this.rememberBytes(fileId, local);
            return local;
        }
        const bytes = await this.readFile(fileId, onProgress);
        this.rememberBytes(fileId, bytes);
        return bytes;
    }

    /**
     * A library PDF's bytes, for drawing its pages (MF-D16). Read through the
     * `readMediaFile` callable in parts, since a Storage bucket sends no
     * cross-origin header without a CORS setup and one callable reply holds
     * about 10 MB. `onProgress` gets 0 to 100.
     */
    async readFile(fileId: string, onProgress: (percent: number) => void = () => {}): Promise<Blob> {
        const parts: Uint8Array[] = [];
        let offset = 0;
        let total = Infinity;
        while (offset < total) {
            const { data } = await this.readMediaFileFn({ fileId, offset });
            total = data.total;
            const part = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0));
            if (!part.length && offset < total) throw new Error('The file stopped part-way.');
            parts.push(part);
            offset += part.length;
            onProgress(total ? Math.min(100, (offset / total) * 100) : 100);
        }
        return new Blob(parts as BlobPart[], { type: 'application/pdf' });
    }

    /**
     * Keeps a PDF from the computer in Files (PI-D3) and gives its record.
     * The same PDF already there (same name and size, PI-D4) is used as it
     * is, with nothing uploaded. Either way its bytes are remembered, so its
     * pages never need reading back in this visit. Throws what the upload
     * throws (MediaFileUploadError for a file over 20 MB).
     */
    async keepPdf(file: File, onProgress: (percent: number) => void = () => {}): Promise<IMediaFile> {
        // The same PDF opened again while it is still being kept: one upload.
        const key = `${file.name}:${file.size}`;
        const running = this.keeping.get(key);
        if (running) return running;
        const keeping = this.storePdf(file, onProgress).finally(() => this.keeping.delete(key));
        this.keeping.set(key, keeping);
        return keeping;
    }

    /** PDFs being kept right now, by name and size. */
    private keeping = new Map<string, Promise<IMediaFile>>();

    private async storePdf(file: File, onProgress: (percent: number) => void): Promise<IMediaFile> {
        const same = (await this.listAll()).find((f) => f.type === 'pdf' && isSameUpload(f, file));
        if (same) {
            onProgress(100);
            this.rememberBytes(same.id, file);
            return same;
        }
        const uploaded = await this.fileUpload.uploadDocument(file, onProgress);
        let id: string;
        try {
            [id] = await firstValueFrom(this.addBatch([uploaded]));
        } catch (error) {
            // A file no tab lists could never be found or deleted: take it back out.
            await this.fileUpload.removeStored(FileUploadService.storedPaths(uploaded));
            throw error;
        }
        this.rememberBytes(id, file);
        return { ...uploaded, id } as IMediaFile;
    }

    /**
     * Saves the panel's edits. A new title also becomes the name a download
     * is saved under; that is best effort, since the title is what matters.
     */
    async saveDetails(file: IMediaFile, details: MediaFileDetails): Promise<void> {
        const changes: Record<string, string> = {};
        if (details.title !== undefined) changes['title'] = details.title.trim() || file.title;
        if (details.notes !== undefined) changes['notes'] = details.notes.trim();
        await runInInjectionContext(this.injector, () => updateDoc(doc(this.db, 'mediaFiles', file.id), { ...changes, modifiedAt: new Date() }));

        const allowed = allowedFileOf(file.name);
        if (changes['title'] && changes['title'] !== file.title && allowed && file.path) {
            try {
                const bucket = await this.arcStorage.get();
                await runInInjectionContext(this.injector, () =>
                    updateMetadata(ref(bucket, file.path), { contentDisposition: contentDispositionFor(allowed, changes['title']) }));
            } catch (error) {
                console.warn('Could not update the download name:', error);
            }
        }
    }

    /**
     * Removes the file, its thumbnail and its record. A file already gone
     * from Storage does not stop the rest: the record must not outlive it.
     * Images taken from a PDF are their own uploads and stay.
     */
    async deleteFile(id: string): Promise<void> {
        const bucket = await this.arcStorage.get();
        await runInInjectionContext(this.injector, async () => {
            const snap = await getDoc(doc(this.db, 'mediaFiles', id));
            if (!snap.exists()) throw new Error('That file is no longer in the library.');
            const data = snap.data() as Partial<IMediaFile>;
            for (const path of [data.path, data.thumbnail?.path]) {
                if (!path) continue;
                try {
                    await deleteObject(ref(bucket, path));
                } catch (error: any) {
                    if (error?.code !== 'storage/object-not-found') throw error;
                }
            }
            await deleteDoc(doc(this.db, 'mediaFiles', id));
        });
        this.recent.delete(id);
    }
}

/** A `mediaFiles` document as the library uses it; Firestore timestamps become dates. */
export function toMediaFile(id: string, data: Record<string, any>): IMediaFile {
    return {
        ...(data as IMediaFile),
        id,
        title: data['title'] || data['name'] || '',
        bytes: Number(data['bytes']) || 0,
        uploadTime: data['uploadTime']?.toDate?.() ?? data['uploadTime'],
    };
}
