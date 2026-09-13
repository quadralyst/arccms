import { inject, Injectable } from '@angular/core';
import { deleteObject, getDownloadURL, ref, Storage, uploadBytesResumable } from '@angular/fire/storage';
import { deleteDoc, doc, Firestore, getDoc } from '@angular/fire/firestore';
import { IMAGE_SIZES, ImageSize, imageSizeWidths } from '../utils/image-sizes';

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
    maxWidth: number;      // in px — also the width of the XL size
    maxHeight: number;     // in px
    convertToWebp: boolean; // Convert uploaded images to WebP (except GIFs)
}

/**
 * Mirrors the media defaults in DEFAULT_MISC_SETTINGS (Settings → Misc).
 * WebP is on: a new install should get small images without being told to.
 */
export const DEFAULT_UPLOAD_SETTINGS: MediaUploadSettings = {
    maxFileSize: 5,
    maxWidth: 1200,
    maxHeight: 1200,
    convertToWebp: true,
};

/** One stored size of an upload. */
export interface ImageVariant {
    url: string;
    /** Storage path, kept so a delete can find every size. */
    path: string;
    width: number;
    height: number;
}

/**
 * What an upload leaves behind. `downloadURL` is the XL size — the whole
 * image at the configured maximum — so anything reading only that field
 * gets the same thing it always did. GIFs are stored once, untouched, and
 * carry no variants.
 */
export interface UploadedMedia {
    downloadURL: string;
    name: string;
    uploadTime: Date;
    width?: number;
    height?: number;
    variants?: Record<ImageSize, ImageVariant>;
}

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

            // Every stored size goes, not just the one `downloadURL` points at.
            // The XL variant *is* downloadURL, so it is deleted through its path.
            const variants: ImageVariant[] = data.variants ? Object.values(data.variants) : [];
            const targets = variants.length > 0
                ? [...new Set(variants.map((variant) => variant.path))]
                : [data.downloadURL];

            for (const target of targets) {
                const storageRef = ref(storage, target);
                await deleteObject(storageRef);
            }

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
     * Bounds `width × height` to fit within `maxWidth × maxHeight`, never
     * enlarging. Returns the same numbers when the image already fits.
     */
    private fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
        const scale = Math.min(1, maxWidth / width, maxHeight / height);
        if (scale === 1) return { width, height };
        return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
    }

    /**
     * Draws `img` at `width × height` and encodes it — WebP when asked, else
     * the source type. Lossy types get a fixed quality.
     */
    private encodeImage(img: HTMLImageElement, width: number, height: number, outputType: string): Promise<Blob> {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);

        const quality = (outputType === 'image/jpeg' || outputType === 'image/webp') ? 0.9 : undefined;

        return new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed.'))),
                outputType,
                quality,
            );
        });
    }

    /** Uploads one blob and resolves to its download URL, reporting progress as 0–100. */
    private uploadBlob(path: string, blob: Blob, contentType: string, onProgress: (pct: number) => void): Promise<string> {
        const storageRef = ref(this.storage, path);
        const uploadTask = uploadBytesResumable(storageRef, blob, { contentType });

        return new Promise((resolve, reject) => {
            uploadTask.on(
                'state_changed',
                (snapshot) => onProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
                (error) => {
                    console.error('Error during image upload:', error);
                    reject(error);
                },
                async () => resolve(await getDownloadURL(storageRef)),
            );
        });
    }

    /**
     * Upload a File to Firebase Storage in every size.
     *
     * Flow: File → validate → decode → XL bounded by the max dimensions →
     * L / M / S at ¾, ½, ¼ of the max width → upload each → one record.
     *
     * A size the image is too small to fill is not upscaled: it reuses the
     * next size up, so a 500px photo stores S and M and points L and XL at M.
     * Progress covers the whole set. GIFs skip all of this — re-encoding
     * would drop the animation — and are stored once, as they are.
     */
    async uploadFile(
        file: File,
        settings: MediaUploadSettings = DEFAULT_UPLOAD_SETTINGS,
        progressCallback: (progress: number) => void,
    ): Promise<UploadedMedia> {
        const typeError = this.validateFileType(file);
        if (typeError) {
            throw new Error(typeError);
        }

        if (file.type === 'image/gif') {
            const sizeError = this.validateFileSize(file, settings.maxFileSize);
            if (sizeError) throw new Error(sizeError);
            const filename = this.generateSeoFilename(file.name, file.type);
            const downloadURL = await this.uploadBlob(`mediaImages/${filename}`, file, file.type, progressCallback);
            return { downloadURL, name: filename, uploadTime: new Date() };
        }

        const outputMimeType = settings.convertToWebp ? 'image/webp' : file.type;
        const img = await this.loadImageFromFile(file);

        // Decide the pixel size of every variant before encoding anything.
        const xl = this.fitWithin(img.naturalWidth, img.naturalHeight, settings.maxWidth, settings.maxHeight);
        const targetWidths = imageSizeWidths(settings.maxWidth);
        const dimensions = {} as Record<ImageSize, { width: number; height: number }>;
        for (const size of IMAGE_SIZES) {
            dimensions[size] = size === 'xl'
                ? xl
                : this.fitWithin(xl.width, xl.height, targetWidths[size], Number.POSITIVE_INFINITY);
        }

        // Encode each distinct pixel size once; equal sizes share one file.
        const encoded = new Map<string, { blob: Blob; width: number; height: number }>();
        for (const size of IMAGE_SIZES) {
            const { width, height } = dimensions[size];
            const dimKey = `${width}x${height}`;
            if (!encoded.has(dimKey)) {
                encoded.set(dimKey, { blob: await this.encodeImage(img, width, height, outputMimeType), width, height });
            }
        }

        // The size limit applies to the largest file — the one that used to be
        // the only file.
        const xlBlob = encoded.get(`${xl.width}x${xl.height}`)!.blob;
        const sizeError = this.validateFileSize(
            new File([xlBlob], file.name, { type: outputMimeType }),
            settings.maxFileSize,
        );
        if (sizeError) {
            throw new Error(sizeError);
        }

        const filename = this.generateSeoFilename(file.name, outputMimeType);
        const extension = filename.slice(filename.lastIndexOf('.'));
        const baseName = filename.slice(0, -extension.length);

        // Upload largest first, so a failure part-way leaves the useful files.
        const order: ImageSize[] = ['xl', 'l', 'm', 's'];
        const uploaded = new Map<string, ImageVariant>();
        const totalBytes = [...encoded.values()].reduce((sum, item) => sum + item.blob.size, 0);
        let doneBytes = 0;

        for (const size of order) {
            const { width, height } = dimensions[size];
            const dimKey = `${width}x${height}`;
            if (uploaded.has(dimKey)) continue;

            const { blob } = encoded.get(dimKey)!;
            const path = `mediaImages/${baseName}-${size}${extension}`;
            const url = await this.uploadBlob(path, blob, outputMimeType, (pct) => {
                progressCallback(totalBytes ? ((doneBytes + (blob.size * pct) / 100) / totalBytes) * 100 : pct);
            });
            doneBytes += blob.size;
            uploaded.set(dimKey, { url, path, width, height });
        }

        const variants = {} as Record<ImageSize, ImageVariant>;
        for (const size of IMAGE_SIZES) {
            const { width, height } = dimensions[size];
            variants[size] = uploaded.get(`${width}x${height}`)!;
        }

        return {
            downloadURL: variants.xl.url,
            name: `${baseName}-xl${extension}`,
            uploadTime: new Date(),
            width: xl.width,
            height: xl.height,
            variants,
        };
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
