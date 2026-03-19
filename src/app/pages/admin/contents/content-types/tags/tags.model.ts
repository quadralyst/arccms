import { IBaseModel, OmitCommonFields } from '../../../../../../shared/models/base-model';

/**
 * Interface for tag items
 * Tags are scoped per content type (stored in Tags_{contentTypeSlug} collections)
 */
export interface ITag extends IBaseModel {
    id: string;
    label: string;
    color: string;
    contentTypeSlug: string;
    usageCount: number;
}

export type TagData = OmitCommonFields<ITag>;

export const COMPONENT_NAME: string = 'Tags';

/**
 * Helper function to get collection name for a content type
 */
export function getTagsCollectionName(contentTypeSlug: string): string {
    return `Tags_${contentTypeSlug}`;
}
