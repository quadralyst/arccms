import { inject, Injectable } from '@angular/core';
import { collection, Firestore, getDocs, orderBy, query } from '@angular/fire/firestore';
import {
    getBlob,
    ref,
    Storage,
} from '@angular/fire/storage';
import JSZip from 'jszip';
import { FileExportProgress, MediaDocInfo } from '../data-constants';

@Injectable({ providedIn: 'root' })
export class ExportFilesService {
    private storage = inject(Storage);
    private db = inject(Firestore);

    /**
     * Load all media items from the Firestore `media` collection.
     * Each document contains: downloadURL, name, storagePath, uploadTime, type.
     */
    async getMediaItems(): Promise<MediaDocInfo[]> {
        const colRef = collection(this.db, 'media');
        const q = query(colRef, orderBy('uploadTime', 'desc'));
        const snapshot = await getDocs(q);
        const items: MediaDocInfo[] = [];

        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            items.push({
                id: docSnap.id,
                name: data['name'] || docSnap.id,
                downloadURL: data['downloadURL'] || '',
                storagePath: data['storagePath'] || '',
                uploadTime: data['uploadTime']?.toDate?.()
                    ? data['uploadTime'].toDate().toISOString()
                    : data['uploadTime'] || '',
                type: data['type'] || '',
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
            const fileRef = ref(this.storage, path);
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
