import { inject, Injectable } from '@angular/core';
import { deleteObject, getDownloadURL, ref, Storage, uploadBytesResumable } from '@angular/fire/storage';
import { deleteDoc, doc, Firestore, getDoc } from '@angular/fire/firestore';

/** Allowed MIME types for media upload */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Map MIME type to file extension */
const MIME_TO_EXTENSION: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
};

export interface MediaUploadSettings {
    maxFileSize: number;   // in MB
    maxWidth: number;      // in px
    maxHeight: number;     // in px
    convertToWebp: boolean; // Convert uploaded images to WebP (except GIFs)
}

export const DEFAULT_UPLOAD_SETTINGS: MediaUploadSettings = {
    maxFileSize: 5,
    maxWidth: 1920,
    maxHeight: 1080,
    convertToWebp: false,
};

@Injectable({
    providedIn: 'root'
})
export class FileUploadService {
    private firestore = inject(Firestore);
    private storage = inject(Storage);

    constructor() { }

    async deleteMediaItem(mediaId: string): Promise<void> {
        const db = this.firestore;
        const storage = this.storage;

        try {
            const docRef = doc(db, 'media', mediaId);
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists()) {
                throw new Error('Media item not found in Firestore');
            }

            const data: any = docSnap.data();
            const filePath = data.downloadURL;

            const storageRef = ref(storage, filePath);
            await deleteObject(storageRef);

            await deleteDoc(docRef);
        } catch (error) {
            throw new Error(`Failed to delete media item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Validate that a file is an allowed image type.
     * Returns null if valid, or an error message string if invalid.
     */
    validateFileType(file: File): string | null {
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            return `Invalid file type. Allowed types: JPEG, PNG, WebP, GIF.`;
        }
        return null;
    }

    /**
     * Validate file size against the configured maximum.
     * Called after resize so only the final payload is checked.
     * Returns null if valid, or an error message string if too large.
     */
    validateFileSize(file: File, maxSizeMB: number): string | null {
        const maxBytes = maxSizeMB * 1024 * 1024;
        if (file.size > maxBytes) {
            const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
            return `File size (${fileSizeMB} MB) exceeds the maximum allowed size (${maxSizeMB} MB).`;
        }
        return null;
    }

    /**
     * Load a File into an HTMLImageElement.
     */
    private loadImageFromFile(file: File): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image.'));
            };
            img.src = url;
        });
    }

    /**
     * Resize an image if it exceeds max dimensions, preserving aspect ratio.
     * GIFs are returned as-is to preserve animation.
     * When convertToWebp is true, non-GIF images are re-encoded as WebP.
     * Images within bounds are returned without re-encoding (unless WebP conversion is active).
     */
    async resizeImage(file: File, maxWidth: number, maxHeight: number, convertToWebp = false): Promise<Blob> {
        // GIF files should not be resized or converted (would lose animation)
        if (file.type === 'image/gif') {
            return file;
        }

        const img = await this.loadImageFromFile(file);
        let { width, height } = img;

        const needsResize = width > maxWidth || height > maxHeight;

        // No resize needed and no format conversion — return original
        if (!needsResize && !convertToWebp) {
            return file;
        }

        // Calculate new dimensions maintaining aspect ratio
        if (needsResize) {
            const aspectRatio = width / height;
            if (width > maxWidth) {
                width = maxWidth;
                height = Math.round(width / aspectRatio);
            }
            if (height > maxHeight) {
                height = maxHeight;
                width = Math.round(height * aspectRatio);
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);

        const outputType = convertToWebp ? 'image/webp' : file.type;
        const quality = (outputType === 'image/jpeg' || outputType === 'image/webp') ? 0.9 : undefined;

        return new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Canvas toBlob failed.'));
                    }
                },
                outputType,
                quality,
            );
        });
    }

    /**
     * Generate an SEO-friendly filename from the original filename.
     *
     * Sanitizes the name (lowercase, hyphens, no special chars),
     * truncates to 50 chars, appends a 6-char random suffix,
     * and uses the correct extension based on MIME type.
     *
     * Example: "My Vacation Photo.png" → "my-vacation-photo-a1b2c3.png"
     */
    generateSeoFilename(originalName: string, mimeType: string): string {
        const nameWithoutExt = originalName.replace(/\.[^/.]+$/, '');

        let sanitized = nameWithoutExt
            .toLowerCase()
            .replace(/[\s_]+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        if (sanitized.length > 50) {
            sanitized = sanitized.substring(0, 50).replace(/-$/, '');
        }

        if (!sanitized) {
            sanitized = 'image';
        }

        const suffix = Math.random().toString(36).substring(2, 8);
        const extension = MIME_TO_EXTENSION[mimeType] || '.jpg';

        return `${sanitized}-${suffix}${extension}`;
    }

    /**
     * Upload a File to Firebase Storage after optional resize.
     *
     * Flow: File → validate → resize (if needed) → SEO filename → upload
     */
    async uploadFile(
        file: File,
        settings: MediaUploadSettings = DEFAULT_UPLOAD_SETTINGS,
        progressCallback: (progress: number) => void,
    ): Promise<{ downloadURL: string; name: string; uploadTime: Date }> {
        const typeError = this.validateFileType(file);
        if (typeError) {
            throw new Error(typeError);
        }

        const convertToWebp = settings.convertToWebp && file.type !== 'image/gif';
        const blob = await this.resizeImage(file, settings.maxWidth, settings.maxHeight, convertToWebp);

        // Determine the actual output MIME type (may differ from original if converted to WebP)
        const outputMimeType = convertToWebp ? 'image/webp' : file.type;

        // Validate file size after resize so large originals that shrink enough are accepted
        const sizeError = this.validateFileSize(
            new File([blob], file.name, { type: outputMimeType }),
            settings.maxFileSize,
        );
        if (sizeError) {
            throw new Error(sizeError);
        }
        const filename = this.generateSeoFilename(file.name, outputMimeType);
        const storageRef = ref(this.storage, `mediaImages/${filename}`);

        const uploadTask = uploadBytesResumable(storageRef, blob, {
            contentType: outputMimeType,
        });

        return new Promise((resolve, reject) => {
            uploadTask.on(
                'state_changed',
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    progressCallback(progress);
                },
                (error) => {
                    console.error('Error during image upload:', error);
                    reject(error);
                },
                async () => {
                    const downloadURL = await getDownloadURL(storageRef);
                    resolve({
                        downloadURL,
                        name: filename,
                        uploadTime: new Date(),
                    });
                },
            );
        });
    }

    /**
     * @deprecated Use uploadFile() instead.
     */
    async uploadFileInDb(base64Image: any, progressCallback: (progress: number) => void): Promise<{ downloadURL: string, name: string, uploadTime: Date }> {
        try {
            const storage = this.storage;
            const uniquename = this.generateUniqueImageName();

            const storageRef = ref(storage, `mediaImages/${uniquename}.jpg`);
            const byteCharacters = atob(base64Image.split(',')[1]);
            const byteNumbers = new Array(byteCharacters.length);

            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }

            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/jpeg' });

            const uploadTask = uploadBytesResumable(storageRef, blob);

            return new Promise((resolve, reject) => {
                uploadTask.on('state_changed',
                    (snapshot) => {
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                        progressCallback(progress);
                    },
                    (error) => {
                        console.error('Error during image upload:', error);
                        reject(error);
                    },
                    async () => {
                        const downloadURL = await getDownloadURL(storageRef);
                        const uploadTime = new Date();

                        resolve({
                            downloadURL,
                            name: uniquename,
                            uploadTime
                        });
                    }
                );
            });
        } catch (error) {
            console.error('Error during image upload:', error);
            throw new Error('Failed to upload or retrieve image.');
        }
    }

    public generateUniqueImageName(): string {
        const timestamp = new Date().getTime();
        return `image_${timestamp}`;
    }
}
