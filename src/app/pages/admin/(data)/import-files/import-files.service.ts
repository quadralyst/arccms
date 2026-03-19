import { inject, Injectable } from '@angular/core';
import { doc, Firestore, setDoc } from '@angular/fire/firestore';
import {
    getDownloadURL,
    ref,
    Storage,
    uploadBytesResumable,
} from '@angular/fire/storage';
import { FileImportProgress, UploadResult } from '../data-constants';

export interface FileWithPath {
    file: File;
    storagePath: string;
}

@Injectable({ providedIn: 'root' })
export class ImportFilesService {
    private storage = inject(Storage);
    private db = inject(Firestore);

    /**
     * Upload a single file to Firebase Storage.
     */
    async uploadFile(
        file: File,
        storagePath: string,
        progressCallback: (progress: number) => void,
    ): Promise<{ downloadURL: string; fullPath: string }> {
        const storageRef = ref(this.storage, storagePath);
        const uploadTask = uploadBytesResumable(storageRef, file);

        return new Promise((resolve, reject) => {
            uploadTask.on(
                'state_changed',
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    progressCallback(progress);
                },
                (error) => reject(error),
                async () => {
                    const downloadURL = await getDownloadURL(storageRef);
                    resolve({ downloadURL, fullPath: storagePath });
                },
            );
        });
    }

    /**
     * Upload multiple files with progress tracking.
     */
    async uploadFiles(
        files: FileWithPath[],
        progressCallback: (progress: FileImportProgress) => void,
    ): Promise<UploadResult[]> {
        const results: UploadResult[] = [];
        let filesCompleted = 0;
        let bytesUploaded = 0;

        for (const { file, storagePath } of files) {
            progressCallback({
                currentFile: file.name,
                filesCompleted,
                totalFiles: files.length,
                bytesUploaded,
            });

            try {
                const { downloadURL } = await this.uploadFile(file, storagePath, () => {});
                results.push({
                    fileName: file.name,
                    storagePath,
                    downloadURL,
                    success: true,
                });
                bytesUploaded += file.size;
            } catch (error: any) {
                results.push({
                    fileName: file.name,
                    storagePath,
                    downloadURL: '',
                    success: false,
                    error: error.message || 'Upload failed',
                });
            }

            filesCompleted++;
        }

        progressCallback({
            currentFile: 'Complete',
            filesCompleted: files.length,
            totalFiles: files.length,
            bytesUploaded,
        });

        return results;
    }

    /**
     * Update the media collection with metadata for uploaded files.
     */
    async updateMediaMetadata(uploadResults: UploadResult[]): Promise<void> {
        const successfulUploads = uploadResults.filter((r) => r.success);

        for (const result of successfulUploads) {
            const docRef = doc(this.db, 'media', this.generateMediaId());
            await setDoc(docRef, {
                downloadURL: result.downloadURL,
                name: result.fileName,
                storagePath: result.storagePath,
                uploadTime: new Date(),
            });
        }
    }

    /**
     * Import files from a manifest JSON, matching by filename.
     * The manifest maps original metadata to storage paths.
     */
    async importFromManifest(
        manifest: Record<string, any>,
        files: File[],
        progressCallback: (progress: FileImportProgress) => void,
    ): Promise<UploadResult[]> {
        const fileMap = new Map<string, File>();
        for (const file of files) {
            fileMap.set(file.name, file);
        }

        const filesToUpload: FileWithPath[] = [];

        for (const [_docId, metadata] of Object.entries(manifest)) {
            const storagePath = metadata.storagePath || metadata.downloadURL;
            const fileName = metadata.name;

            if (fileName && fileMap.has(fileName)) {
                filesToUpload.push({
                    file: fileMap.get(fileName)!,
                    storagePath: storagePath || `mediaImages/${fileName}`,
                });
            }
        }

        return this.uploadFiles(filesToUpload, progressCallback);
    }

    private generateMediaId(): string {
        return `media_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }
}
