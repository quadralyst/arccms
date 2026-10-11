import { IBaseModel, OmitCommonFields } from '../../../../shared/models/base-model';
import { ImageVariant } from '../../../../shared/services/file-upload.service';
import { ImageSize } from '../../../../shared/utils/image-sizes';

export interface IMediaManager extends IBaseModel {
    /** Never written by the uploader; kept optional for any document that has it. */
    type?: string;
    downloadURL?: string;
    name?: string;
    /** What the library shows; written at upload. Older uploads show their file name until edited. */
    title?: string;
    /** Put in an image's `alt` when it is inserted in rich text (MF-D22). */
    alt?: string;
    /** Staff only (MF-D21, MF-D24). */
    notes?: string;
    uploadTime?: Date;
    width?: number;
    height?: number;
    /** Every stored size (see shared/utils/image-sizes.ts). Absent on GIFs and older uploads. */
    variants?: Record<ImageSize, ImageVariant>;
}

export type MediaManagerFormData = OmitCommonFields<IMediaManager>;

export const COMPONENT_NAME: string = 'Media Manager';
