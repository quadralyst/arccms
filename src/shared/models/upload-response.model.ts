/**
 * Upload Response Model
 * 
 * Defines the structure for file upload progress and result.
 */

export interface UploadResponse {
    progress: number;
    downloadURL: string;
}

export interface UploadTask {
    file: File;
    path: string;
    progress: number;
    downloadURL?: string;
    error?: string;
    status: 'pending' | 'uploading' | 'complete' | 'error';
}
