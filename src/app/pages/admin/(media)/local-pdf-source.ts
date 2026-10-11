import { signal } from '@angular/core';
import { MediaFileUploadError } from '../../../../shared/services/file-upload.service';
import { NotifyService } from '../../../../shared/services/notify.service';
import { defaultTitle, formatBytes } from '../../../../shared/utils/media-files';
import { IMediaFile } from './media-files.model';
import { PdfImageSource } from './pdf-image-taker/pdf-image-taker.component';

/** A PDF from the computer, opened at once and kept in Files once it has opened. */
export interface LocalPdf {
    source: PdfImageSource;
    /** Call with true when the taker has opened it, false when it could not. */
    opened: (ok: boolean) => void;
}

/**
 * A PDF chosen or dropped from the computer (PI-D3, PI-D6). Its pages open
 * from the local bytes straight away; it is kept in Files alongside, but only
 * once it has opened, so a locked or broken PDF is not kept from here
 * (assumption 3 of specs/pdf-images-spec.md). A file Files will not take (over
 * 20 MB) is reported, and its images still save, without a source.
 */
export function localPdfSource(
    file: File,
    keep: (file: File, onProgress: (percent: number) => void) => Promise<IMediaFile>,
    notify: NotifyService,
    onKept: (kept: IMediaFile) => void = () => {},
): LocalPdf {
    const percent = signal(0);
    let settle: (ok: boolean) => void = () => {};
    const opened = new Promise<boolean>((resolve) => (settle = resolve));
    const done = opened.then(async (ok) => {
        if (!ok) return null;
        try {
            const kept = await keep(file, (p) => percent.set(Math.round(p)));
            onKept(kept);
            return kept.id;
        } catch (error) {
            if (error instanceof MediaFileUploadError && error.problem === 'size') {
                notify.error('admin.media.files.error_size', { name: file.name, size: formatBytes(error.bytes) });
            } else {
                console.error('Could not keep the PDF in Files:', error);
                notify.error('admin.media.files.upload_failed', { name: file.name });
            }
            return null;
        }
    });
    return {
        source: {
            title: defaultTitle(file.name),
            key: `local:${file.name}:${file.size}`,
            load: async () => file,
            storing: { done, percent },
        },
        opened: settle,
    };
}
