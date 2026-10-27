import { inject, Injectable } from '@angular/core';
import { collection, Firestore, getDocs, orderBy, query } from '@angular/fire/firestore';
import {
    getBlob,
    ref,
} from '@angular/fire/storage';
import { ArcStorage } from '../../../../core/config/arc-storage';
import JSZip from 'jszip';
import { FileExportProgress, MediaDocInfo } from '../data-constants';

@Injectable({ providedIn: 'root' })
export class ExportFilesService {
    private arcStorage = inject(ArcStorage);
    private db = inject(Firestore);

    /**
     * Load every library item: images from `media`, then documents from
     * `mediaFiles` (docs/features/media.html, Files), newest first in each.
     */
    async getMediaItems(): Promise<MediaDocInfo[]> {
        const items: MediaDocInfo[] = [];
        const uploadTime = (value: any) => value?.toDate?.() ? value.toDate().toISOString() : value || '';

        const images = await getDocs(query(collection(this.db, 'media'), orderBy('uploadTime', 'desc')));
        for (const docSnap of images.docs) {
            const data = docSnap.data();
            items.push({
                id: docSnap.id,
                name: data['name'] || docSnap.id,
                downloadURL: data['downloadURL'] || '',
                storagePath: data['storagePath'] || '',
                uploadTime: uploadTime(data['uploadTime']),
                type: data['type'] || '',
                collection: 'media',
                ...details(data),
            });
        }

        const files = await getDocs(query(collection(this.db, 'mediaFiles'), orderBy('uploadTime', 'desc')));
        for (const docSnap of files.docs) {
            const data = docSnap.data();
            items.push({
                id: docSnap.id,
                name: data['name'] || docSnap.id,
                downloadURL: data['downloadURL'] || '',
                storagePath: data['path'] || '',
                uploadTime: uploadTime(data['uploadTime']),
                type: data['type'] || '',
                collection: 'mediaFiles',
                previewURL: data['thumbnail']?.url,
                ...details(data),
            });
        }

        return items;
    }

    /**
     * Download a single file via Firebase SDK getBlob (handles auth + CORS).
     * If storagePath is missing, extracts it from the downloadURL.
     */
    async downloadFile(item: MediaDocInfo): Promise<Blob> {
        const path = item.storagePath || this.extractStoragePath(item.downloadURL);

        if (path) {
            const fileRef = ref(await this.arcStorage.get(), path);
            return getBlob(fileRef);
        }

        throw new Error(`Cannot determine storage path for ${item.name}`);
    }

    /**
     * Extract the storage path from a Firebase Storage download URL.
     * URL format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded-path}?alt=media&token=...
     */
    private extractStoragePath(downloadURL: string): string {
        if (!downloadURL) return '';
        try {
            const match = downloadURL.match(/\/o\/([^?]+)/);
            return match ? decodeURIComponent(match[1]) : '';
        } catch {
            return '';
        }
    }

    /**
     * Download selected media items as a ZIP archive.
     * Includes the actual files + a media-manifest.json with metadata.
     */
    async downloadAsZip(
        items: MediaDocInfo[],
        progressCallback: (progress: FileExportProgress) => void,
    ): Promise<Blob> {
        const zip = new JSZip();
        let filesCompleted = 0;
        let bytesDownloaded = 0;

        for (const item of items) {
            progressCallback({
                currentFile: item.name,
                filesCompleted,
                totalFiles: items.length,
                bytesDownloaded,
            });

            try {
                const blob = await this.downloadFile(item);

                // Derive file extension from storagePath or downloadURL
                const ext = this.getFileExtension(item);
                const zipPath = item.storagePath || `media/${item.name}${ext}`;
                zip.file(zipPath, blob);
                filesCompleted++;
                bytesDownloaded += blob.size;
            } catch (error) {
                // Skip files that fail to download; continue with others
                console.warn(`Failed to download ${item.name}:`, error);
                filesCompleted++;
            }
        }

        // Include media manifest JSON in the ZIP
        const manifest: Record<string, any> = {};
        for (const item of items) {
            manifest[item.id] = {
                name: item.name,
                downloadURL: item.downloadURL,
                storagePath: item.storagePath,
                uploadTime: item.uploadTime,
                type: item.type,
                ...(item.collection === 'mediaFiles' ? { collection: 'mediaFiles' } : {}),
                ...details(item as Record<string, any>),
            };
        }
        zip.file('media-manifest.json', JSON.stringify(manifest, null, 2));

        progressCallback({
            currentFile: 'Creating ZIP...',
            filesCompleted: items.length,
            totalFiles: items.length,
            bytesDownloaded,
        });

        return zip.generateAsync({ type: 'blob' });
    }

    /**
     * Extract file extension from storagePath or downloadURL.
     */
    private getFileExtension(item: MediaDocInfo): string {
        const path = item.storagePath || item.downloadURL || '';
        const match = path.match(/\.\w{2,5}(?=[?#]|$)/);
        return match ? match[0] : '';
    }

    /**
     * Trigger browser download of a blob.
     */
    triggerDownload(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

/** The library details worth carrying to another project; only those that are set. */
function details(data: Record<string, any>): Pick<MediaDocInfo, 'title' | 'alt' | 'notes'> {
    const out: Pick<MediaDocInfo, 'title' | 'alt' | 'notes'> = {};
    for (const key of ['title', 'alt', 'notes'] as const) {
        if (typeof data[key] === 'string' && data[key]) out[key] = data[key];
    }
    return out;
}
