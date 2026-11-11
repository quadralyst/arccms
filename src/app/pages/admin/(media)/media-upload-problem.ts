import { TranslationKey } from '../../../core/i18n/translation-keys';

/** A translated sentence for an image upload or save that failed. */
export interface UploadProblem {
    key: TranslationKey;
    params: Record<string, unknown>;
}

/**
 * Why an image could not be uploaded or saved, as a plain sentence the admin can read.
 *
 * FileUploadService throws English text for its own checks (the type and the size
 * limit) and passes Firebase's through for the rest. Those are recognised here and
 * turned into our own words; anything else reads as "try again", and the caller keeps
 * the raw error in the console.
 */
export function uploadProblem(error: unknown, maxMb: number, name?: string): UploadProblem {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/exceeds the maximum allowed size/i.test(message)) {
        return name
            ? { key: 'admin.media.problem.too_large_named', params: { name, max: maxMb } }
            : { key: 'admin.media.problem.too_large', params: { max: maxMb } };
    }
    if (/invalid file type/i.test(message) && name) return { key: 'admin.media.problem.type', params: { name } };
    if (/GIFs cannot be cropped/i.test(message)) return { key: 'admin.media.problem.gif', params: {} };
    return name
        ? { key: 'admin.media.problem.upload_named', params: { name } }
        : { key: 'admin.media.problem.try_again', params: {} };
}
