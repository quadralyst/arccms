import { inject, Injectable } from '@angular/core';
import { collection, doc, Firestore, setDoc } from '@angular/fire/firestore';
import {
    getDownloadURL,
    ref,
    uploadBytesResumable,
} from '@angular/fire/storage';
import { withStoragePrefix } from '../../../../core/config/arc-config';
import { ArcStorage } from '../../../../core/config/arc-storage';
import { FileUploadService } from '../../../../../shared/services/file-upload.service';
import { isLibraryDocument } from '../../../../../shared/utils/media-files';
import { FileImportProgress, UploadResult } from '../data-constants';

export interface FileWithPath {
    file: File;
    storagePath: string;
    /** Library details from a manifest (title, alt text, notes). */
    details?: UploadResult['details'];
}

/** A document for the library's Files, with the details a manifest carried. */
export interface DocumentToImport {
    file: File;
    details?: { title?: string; notes?: string };
}

@Injectable({ providedIn: 'root' })
export class ImportFilesService {
    private arcStorage = inject(ArcStorage);
    private db = inject(Firestore);
    private fileUpload = inject(FileUploadService);

    /**
     * Upload a single file to Firebase Storage.
     */
    async uploadFile(
        file: File,
        storagePath: string,
        progressCallback: (progress: number) => void,
    ): Promise<{ downloadURL: string; fullPath: string }> {
        const fullPath = withStoragePrefix(storagePath);
        const storageRef = ref(await this.arcStorage.get(), fullPath);
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
                    resolve({ downloadURL, fullPath });
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

        for (const { file, storagePath, details } of files) {
            progressCallback({
                currentFile: file.name,
                filesCompleted,
                totalFiles: files.length,
                bytesUploaded,
            });

            try {
                const { downloadURL, fullPath } = await this.uploadFile(file, storagePath, () => {});
                results.push({
                    fileName: file.name,
                    storagePath: fullPath,
                    downloadURL,
                    success: true,
                    ...(details ? { details } : {}),
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
     * Uploads documents to the library's Files (docs/features/media.html,
     * Files), whatever folder was typed: they are stored, typed and named the
     * way the Files tab stores them, with a fresh first-page thumbnail. With
     * `saveRecords`, each gets its `mediaFiles` record, keeping a manifest's
     * title and notes.
     */
    async uploadDocuments(
        documents: DocumentToImport[],
        saveRecords: boolean,
        progressCallback: (progress: FileImportProgress) => void,
    ): Promise<UploadResult[]> {
        const results: UploadResult[] = [];
        let bytesUploaded = 0;

        for (const [index, { file, details }] of documents.entries()) {
            progressCallback({ currentFile: file.name, filesCompleted: index, totalFiles: documents.length, bytesUploaded });
            try {
                const uploaded = await this.fileUpload.uploadDocument(file, () => {});
                if (saveRecords) {
                    const ref = doc(collection(this.db, 'mediaFiles'));
                    const now = new Date();
                    await setDoc(ref, {
                        ...uploaded,
                        ...(details?.title ? { title: details.title } : {}),
                        ...(details?.notes ? { notes: details.notes } : {}),
                        id: ref.id,
                        createdAt: now,
                        modifiedAt: now,
                    });
                }
                results.push({ fileName: file.name, storagePath: uploaded.path, downloadURL: uploaded.downloadURL, success: true, collection: 'mediaFiles' });
                bytesUploaded += file.size;
            } catch (error: any) {
                results.push({ fileName: file.name, storagePath: '', downloadURL: '', success: false, error: error?.message || 'Upload failed', collection: 'mediaFiles' });
            }
        }

        progressCallback({ currentFile: 'Complete', filesCompleted: documents.length, totalFiles: documents.length, bytesUploaded });
        return results;
    }

    /**
     * Update the media collection with metadata for uploaded files. Documents
     * already have their `mediaFiles` record (uploadDocuments) and are skipped.
     */
    async updateMediaMetadata(uploadResults: UploadResult[]): Promise<void> {
        const successfulUploads = uploadResults.filter((r) => r.success && r.collection !== 'mediaFiles');

        for (const result of successfulUploads) {
            const docRef = doc(this.db, 'media', this.generateMediaId());
            await setDoc(docRef, {
                downloadURL: result.downloadURL,
                name: result.fileName,
                storagePath: result.storagePath,
                uploadTime: new Date(),
                ...(result.details ?? {}),
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
        saveDocumentRecords = true,
    ): Promise<UploadResult[]> {
        const fileMap = new Map<string, File>();
        for (const file of files) {
            fileMap.set(file.name, file);
        }

        const filesToUpload: FileWithPath[] = [];
        const documents: DocumentToImport[] = [];

        for (const [_docId, metadata] of Object.entries(manifest)) {
            const storagePath = metadata.storagePath || metadata.downloadURL;
            const fileName = metadata.name;

            if (fileName && fileMap.has(fileName)) {
                const file = fileMap.get(fileName)!;
                // A library document goes back to Files, with its title and notes.
                if (metadata.collection === 'mediaFiles' || isLibraryDocument(fileName)) {
                    documents.push({ file, details: pickStrings(metadata, ['title', 'notes']) });
                    continue;
                }
                filesToUpload.push({
                    file,
                    storagePath: storagePath || `mediaImages/${fileName}`,
                    details: pickStrings(metadata, ['title', 'alt', 'notes']),
                });
            }
        }

        const results = await this.uploadFiles(filesToUpload, progressCallback);
        if (!documents.length) return results;
        return [...results, ...await this.uploadDocuments(documents, saveDocumentRecords, progressCallback)];
    }

    private generateMediaId(): string {
        return `media_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }
}

/** The string fields of `source` named in `keys` that are set; undefined when none are. */
function pickStrings<K extends string>(source: Record<string, any>, keys: K[]): Partial<Record<K, string>> | undefined {
    const out: Partial<Record<K, string>> = {};
    for (const key of keys) {
        if (typeof source[key] === 'string' && source[key]) out[key] = source[key];
    }
    return Object.keys(out).length ? out : undefined;
}
