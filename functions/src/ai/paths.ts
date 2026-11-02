/**
 * Where AI files go (specs/ai-media-spec.md, AM-D9, AM-D28): Arc's private `ai-files/`
 * folder by default, or the app's own folder. Pure, so the purposes' checks at load and the
 * call's checks can use it without Storage.
 */
import { arcStoragePrefix } from '../arc-config.js';

/** Arc's private folder for files a model made: only admins read it, only the functions write. */
export const AI_FILES_FOLDER = 'ai-files';

/**
 * Folders an app's `saveTo` and `saveAs` may never name, at either of the first two levels
 * (the second for an install's upload prefix): Arc's own private and library folders.
 */
export const RESERVED_FOLDERS = ['ai-files', 'ai-calls', 'users', 'email-logs', 'mediaFiles', 'mediaImages'];

/** What is wrong with a folder or path in the bucket, or null when it may be used. */
export function storagePathProblem(path: unknown, what: string): string | null {
    if (typeof path !== 'string' || !path.trim()) return `${what} must be a path in the project's bucket, such as app/audio`;
    const p = path.trim();
    if (p.startsWith('/') || p.startsWith('gs://') || p.includes('\\') || p.split('/').some((s) => s === '' || s === '.' || s === '..')) {
        return `${what} "${path}" must be a plain path inside the bucket, without a leading /, gs://, or . and .. parts`;
    }
    if (p.length > 300) return `${what} is longer than 300 characters`;
    const [first, second] = p.split('/');
    if (RESERVED_FOLDERS.includes(first) || (second !== undefined && RESERVED_FOLDERS.includes(second))) {
        return `${what} "${path}" is in ${RESERVED_FOLDERS.includes(first) ? first : second}/, one of Arc's own folders`;
    }
    return null;
}

/** Arc's folder for one purpose's files of one month, such as `ai-files/cover/2026-11/`. */
export function aiFilesFolder(purpose: string, month: string): string {
    return `${arcStoragePrefix()}${AI_FILES_FOLDER}/${purpose}/${month}/`;
}

/** Arc's folder for one purpose's files, every month. */
export function aiPurposeFolder(purpose: string): string {
    return `${arcStoragePrefix()}${AI_FILES_FOLDER}/${purpose}/`;
}

/** Whether a path is in Arc's AI folders, which `readAiFile` and `moveAiFile` read. */
export function isAiFilePath(path: string): boolean {
    const prefix = arcStoragePrefix();
    return path.startsWith(`${prefix}${AI_FILES_FOLDER}/`) || path.startsWith(`${prefix}ai-calls/`);
}

/** The file name ending a type gets. */
export function extensionFor(mimeType: string): string {
    const map: Record<string, string> = {
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
        'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
        'video/mp4': 'mp4', 'video/webm': 'webm',
    };
    return map[mimeType] ?? 'bin';
}
