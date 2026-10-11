import { IBaseModel } from '../../../../shared/models/base-model';
import { UploadedDocument } from '../../../../shared/services/file-upload.service';

/**
 * A document in the media library: `mediaFiles/{id}` (docs/features/media.html,
 * What it stores). Staff read and write it; the file itself is public.
 */
export interface IMediaFile extends IBaseModel, UploadedDocument {
    /** Staff only (MF-D21). */
    notes?: string;
}
