import { inject, Injectable } from '@angular/core';
import { deleteObject, getDownloadURL, ref, Storage, uploadBytesResumable } from '@angular/fire/storage';
import { deleteDoc, doc, Firestore, getDoc } from '@angular/fire/firestore';
import { fitLongestSide, IMAGE_SIZES, ImageSize, imageSizeLimits } from '../utils/image-sizes';
import { CropRect, roundCropRect } from '../utils/image-crop';
import { withStoragePrefix } from '../../app/core/config/arc-config';
import {
    allowedFileOf,
    contentDispositionFor,
    defaultTitle,
    MAX_FILE_BYTES,
    MEDIA_FILES_FOLDER,
    MediaFileType,
    storedFileName,
} from '../utils/media-files';
import { openPdf, PdfOpenError } from '../utils/pdf-pages';

/** Allowed MIME types for media upload */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Map MIME type to file extension */
const MIME_TO_EXTENSION: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
};

/** The image type a stored file name implies, by its extension. JPEG when it has none this knows. */
export function mimeTypeOfName(name: string): string {
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (ext === '.jpeg') return 'image/jpeg';
    const match = Object.entries(MIME_TO_EXTENSION).find(([, e]) => e === ext);
    return match ? match[0] : 'image/jpeg';
}

export interface MediaUploadSettings {
    maxFileSize: number;   // in MB
    /** Longest side of the XL size, in px; S/M/L are quarters of it. */
    maxSize: number;
    convertToWebp: boolean; // Convert uploaded images to WebP (except GIFs)
}

/**
 * Mirrors the media defaults in DEFAULT_MISC_SETTINGS (Settings → Misc).
 * WebP is on: a new install should get small images without being told to.
 */
export const DEFAULT_UPLOAD_SETTINGS: MediaUploadSettings = {
    maxFileSize: 5,
    maxSize: 1200,
    convertToWebp: true,
};

/** The media fields of the Settings/misc document. */
export interface MiscMediaFields {
    mediaMaxFileSize?: number;
    mediaMaxSize?: number;
    mediaConvertToWebp?: boolean;
}

/**
 * The upload settings a Settings/misc document holds, the defaults filling
 * any gap. Older Settings docs carry mediaMaxWidth/Height; those are
 * deliberately not read: the longest-side limit is its own setting, and a
 * stale 1920 must not leak into new uploads.
 */
export function uploadSettingsFromMisc(misc: MiscMediaFields | undefined): MediaUploadSettings {
    return {
        maxFileSize: misc?.mediaMaxFileSize ?? DEFAULT_UPLOAD_SETTINGS.maxFileSize,
        maxSize: misc?.mediaMaxSize ?? DEFAULT_UPLOAD_SETTINGS.maxSize,
        convertToWebp: misc?.mediaConvertToWebp ?? DEFAULT_UPLOAD_SETTINGS.convertToWebp,
    };
}

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
    /** What the library shows; starts as the file's own name (defaultTitle). */
    title?: string;
    uploadTime: Date;
    width?: number;
    height?: number;
    variants?: Record<ImageSize, ImageVariant>;
}

/** A document uploaded to the Files tab: the `mediaFiles` record before Firestore adds its common fields. */
export interface UploadedDocument {
    title: string;
    name: string;
    downloadURL: string;
    path: string;
    type: MediaFileType;
    contentType: string;
    bytes: number;
    pages?: number;
    thumbnail?: { url: string; path: string; width: number; height: number };
    uploadTime: Date;
}

/** Why a document was not uploaded; the screen words it (admin.media.files.error_*). */
export class MediaFileUploadError extends Error {
    constructor(readonly problem: 'type' | 'size', readonly bytes: number) {
        super(problem === 'type'
            ? 'This file type cannot be uploaded. Use PDF, Word, Excel, PowerPoint, CSV or text.'
            : `This file is ${(bytes / (1024 * 1024)).toFixed(1)} MB. Files can be up to 20 MB.`);
        this.name = 'MediaFileUploadError';
    }
}

/** The longest side of a PDF's first-page thumbnail (MF-D9). */
export const FILE_THUMBNAIL_SIZE = 400;

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
    private loadImageFromFile(file: Blob): Promise<HTMLImageElement> {
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
     * Draws `img` (or the `source` part of it) at `width × height` and
     * encodes it — WebP when asked, else the source type. Lossy types get a
     * fixed quality.
     */
    private encodeImage(img: HTMLImageElement, width: number, height: number, outputType: string, source?: CropRect): Promise<Blob> {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        if (source) {
            ctx.drawImage(img, source.x, source.y, source.width, source.height, 0, 0, width, height);
        } else {
            ctx.drawImage(img, 0, 0, width, height);
        }

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
    private uploadBlob(path: string, blob: Blob, contentType: string, onProgress: (pct: number) => void, extra: { contentDisposition?: string } = {}): Promise<string> {
        const storageRef = ref(this.storage, path);
        const uploadTask = uploadBytesResumable(storageRef, blob, { contentType, ...extra });

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
     * Upload a member's profile photo to `avatars/{uid}/`, the one storage
     * folder a non-admin may write (storage.rules). Resized to a 512px WebP
     * square-ish bound; no media library record, since members have no access
     * to the media library. Resolves to the download URL for `users.photo`.
     */
    async uploadAvatar(uid: string, file: File): Promise<string> {
        const typeError = this.validateFileType(file);
        if (typeError) {
            throw new Error(typeError);
        }
        const img = await this.loadImageFromFile(file);
        const { width, height } = fitLongestSide(img.naturalWidth, img.naturalHeight, 512);
        const blob = await this.encodeImage(img, width, height, 'image/webp');
        return this.uploadBlob(`avatars/${uid}/avatar-${Date.now()}.webp`, blob, 'image/webp', () => {});
    }

    /**
     * Upload a File to Firebase Storage in every size.
     *
     * Flow: File → validate → decode → XL with its longest side bounded by
     * the max size → L / M / S bounded at ¾, ½, ¼ of it → upload each → one
     * record. Bounding the longest side means "M" is a 600px box whether the
     * photo is landscape or portrait.
     *
     * A size the image is too small to fill is not upscaled: it reuses the
     * encoding of the next size down, but is still stored under its own name,
     * so `{{ key_l }}` always names a file that exists (templates derive every
     * size from one URL, image-sizes.ts). A 500px photo with a 1200 maximum
     * stores one 500px image as -m, -l and -xl, and a 300px one as -s.
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
            const downloadURL = await this.uploadBlob(withStoragePrefix(`mediaImages/${filename}`), file, file.type, progressCallback);
            return { downloadURL, name: filename, title: defaultTitle(file.name), uploadTime: new Date() };
        }

        const outputMimeType = settings.convertToWebp ? 'image/webp' : file.type;
        const img = await this.loadImageFromFile(file);
        const uploaded = await this.storeSizes(img, undefined, file.name, outputMimeType, settings, progressCallback);
        return { ...uploaded, title: defaultTitle(file.name) };
    }

    /**
     * Saves the `crop` part of an existing upload as a new media file set, in
     * every size, and leaves the original alone: content may already use it.
     *
     * `source` is the upload's largest stored size, the best copy there is,
     * since the file first chosen is not kept. It comes as bytes
     * (MediaManagerService.readMediaImage), not a URL, so the canvas may
     * export it whatever the bucket's CORS setup. The copy is named after the
     * original with `-crop`, and gets the original's type unless WebP
     * conversion is on.
     */
    async uploadCroppedCopy(
        source: Blob,
        sourceName: string,
        crop: CropRect,
        settings: MediaUploadSettings = DEFAULT_UPLOAD_SETTINGS,
        progressCallback: (progress: number) => void,
    ): Promise<UploadedMedia> {
        const sourceType = mimeTypeOfName(sourceName);
        if (sourceType === 'image/gif') {
            throw new Error('GIFs cannot be cropped: cropping would drop the animation.');
        }
        const img = await this.loadImageFromFile(source);
        const rect = roundCropRect(crop, img.naturalWidth, img.naturalHeight);
        const outputMimeType = settings.convertToWebp ? 'image/webp' : sourceType;
        const baseName = sourceName.replace(/\.[^/.]+$/, '').replace(/-(s|m|l|xl)$/i, '').replace(/-[a-z0-9]{6}$/i, '').replace(/(-crop)+$/i, '');
        return this.storeSizes(img, rect, `${baseName}-crop`, outputMimeType, settings, progressCallback);
    }

    /**
     * Removes stored files whose library record could not be written, so no
     * file is left that no tab lists and nobody can delete. Best effort: a
     * file already gone is fine, and a failure here is only logged.
     */
    async removeStored(paths: (string | undefined)[]): Promise<void> {
        for (const path of new Set(paths.filter((p): p is string => !!p))) {
            try {
                await deleteObject(ref(this.storage, path));
            } catch (error: any) {
                if (error?.code !== 'storage/object-not-found') console.warn(`Could not remove ${path}:`, error);
            }
        }
    }

    /** The Storage paths of an upload: every size, or the one file of a GIF. */
    static storedPaths(media: UploadedMedia | UploadedDocument): string[] {
        if ('path' in media) return [media.path, media.thumbnail?.path].filter((p): p is string => !!p);
        if (media.variants) return Object.values(media.variants).map((v) => v.path);
        const match = /\/o\/([^?#]+)/.exec(media.downloadURL);
        return match ? [decodeURIComponent(match[1])] : [];
    }

    /**
     * Uploads a document to the Files tab (docs/features/media.html, Files):
     * the type from its extension (MF-D6), at most 20 MB, stored as it is
     * under `mediaFiles/` with the content type and the open-or-download
     * setting from the allowed-files table. A PDF also gets its page count
     * and a first-page thumbnail, drawn here in the browser; a locked or
     * unreadable PDF still uploads, without them (MF-D17).
     *
     * Rejects with a MediaFileUploadError for a type or size the library
     * does not take, before anything is sent.
     */
    async uploadDocument(file: File, progressCallback: (progress: number) => void): Promise<UploadedDocument> {
        const allowed = allowedFileOf(file.name);
        if (!allowed) throw new MediaFileUploadError('type', file.size);
        if (file.size > MAX_FILE_BYTES) throw new MediaFileUploadError('size', file.size);

        const title = defaultTitle(file.name);
        const name = storedFileName(file.name, allowed.extension);
        const path = withStoragePrefix(`${MEDIA_FILES_FOLDER}/${name}`);

        let pages: number | undefined;
        let thumbnailDrawing: { blob: Blob; width: number; height: number } | undefined;
        if (allowed.type === 'pdf') {
            try {
                const pdf = await openPdf(file);
                try {
                    pages = pdf.pageCount;
                    thumbnailDrawing = await pdf.renderPage(1, FILE_THUMBNAIL_SIZE, 'image/jpeg');
                } finally {
                    await pdf.destroy();
                }
            } catch (error) {
                if (!(error instanceof PdfOpenError)) console.warn('Could not draw the PDF thumbnail:', error);
            }
        }

        const thumbBytes = thumbnailDrawing?.blob.size ?? 0;
        const total = file.size + thumbBytes;
        const downloadURL = await this.uploadBlob(path, file, allowed.contentType, (pct) => {
            progressCallback(total ? ((file.size * pct) / 100 / total) * 100 : pct);
        }, { contentDisposition: contentDispositionFor(allowed, title) });

        let thumbnail: UploadedDocument['thumbnail'];
        if (thumbnailDrawing) {
            const thumbPath = withStoragePrefix(`${MEDIA_FILES_FOLDER}/${name.replace(/\.[^.]+$/, '')}-thumb.jpg`);
            try {
                const url = await this.uploadBlob(thumbPath, thumbnailDrawing.blob, 'image/jpeg', (pct) => {
                    progressCallback(((file.size + (thumbBytes * pct) / 100) / total) * 100);
                });
                thumbnail = { url, path: thumbPath, width: thumbnailDrawing.width, height: thumbnailDrawing.height };
            } catch (error) {
                // The document is what was asked for; a card can show its icon.
                console.warn('Could not store the PDF thumbnail:', error);
            }
        }
        progressCallback(100);

        const record: UploadedDocument = {
            title,
            name,
            downloadURL,
            path,
            type: allowed.type,
            contentType: allowed.contentType,
            bytes: file.size,
            uploadTime: new Date(),
        };
        if (pages) record.pages = pages;
        if (thumbnail) record.thumbnail = thumbnail;
        return record;
    }

    /**
     * Stores `img` (or its `crop` part) at every size and returns the record
     * for the media document. See uploadFile for the rules on sizes.
     */
    private async storeSizes(
        img: HTMLImageElement,
        crop: CropRect | undefined,
        originalName: string,
        outputMimeType: string,
        settings: MediaUploadSettings,
        progressCallback: (progress: number) => void,
    ): Promise<UploadedMedia> {
        const sourceWidth = crop?.width ?? img.naturalWidth;
        const sourceHeight = crop?.height ?? img.naturalHeight;

        // Decide the pixel size of every variant before encoding anything.
        const limits = imageSizeLimits(settings.maxSize);
        const dimensions = {} as Record<ImageSize, { width: number; height: number }>;
        for (const size of IMAGE_SIZES) {
            dimensions[size] = fitLongestSide(sourceWidth, sourceHeight, limits[size]);
        }
        const xl = dimensions.xl;

        // Encode each distinct pixel size once; equal sizes share one file.
        const encoded = new Map<string, { blob: Blob; width: number; height: number }>();
        for (const size of IMAGE_SIZES) {
            const { width, height } = dimensions[size];
            const dimKey = `${width}x${height}`;
            if (!encoded.has(dimKey)) {
                encoded.set(dimKey, { blob: await this.encodeImage(img, width, height, outputMimeType, crop), width, height });
            }
        }

        // The size limit applies to the largest file — the one that used to be
        // the only file.
        const xlBlob = encoded.get(`${xl.width}x${xl.height}`)!.blob;
        const sizeError = this.validateFileSize(
            new File([xlBlob], originalName, { type: outputMimeType }),
            settings.maxFileSize,
        );
        if (sizeError) {
            throw new Error(sizeError);
        }

        const filename = this.generateSeoFilename(originalName, outputMimeType);
        const extension = filename.slice(filename.lastIndexOf('.'));
        const baseName = filename.slice(0, -extension.length);

        // Upload largest first, so a failure part-way leaves the useful files.
        // Every size gets its own file, even when it reuses another's encoding.
        const order: ImageSize[] = ['xl', 'l', 'm', 's'];
        const blobFor = (size: ImageSize) => encoded.get(`${dimensions[size].width}x${dimensions[size].height}`)!.blob;
        const totalBytes = order.reduce((sum, size) => sum + blobFor(size).size, 0);
        let doneBytes = 0;
        const variants = {} as Record<ImageSize, ImageVariant>;

        for (const size of order) {
            const { width, height } = dimensions[size];
            const blob = blobFor(size);
            const path = withStoragePrefix(`mediaImages/${baseName}-${size}${extension}`);
            const url = await this.uploadBlob(path, blob, outputMimeType, (pct) => {
                progressCallback(totalBytes ? ((doneBytes + (blob.size * pct) / 100) / totalBytes) * 100 : pct);
            });
            doneBytes += blob.size;
            variants[size] = { url, path, width, height };
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

            const storageRef = ref(storage, withStoragePrefix(`mediaImages/${uniquename}.jpg`));
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
