import { IBaseModel, OmitCommonFields } from '../../../../../shared/models/base-model';

/**
 * Interface for waitlist user tags
 * Tags are scoped per waitlist (stored in WaitlistUserTags_{waitlistId} collections)
 */
export interface IWaitlistUserTag extends IBaseModel {
    id: string;
    label: string;
    color: string;
    waitlistId: string;
    usageCount: number;
}

export type WaitlistUserTagData = OmitCommonFields<IWaitlistUserTag>;

export const WAITLIST_TAGS_COMPONENT_NAME: string = 'WaitlistUserTags';

/**
 * Helper function to get collection name for a waitlist's tags
 */
export function getWaitlistUserTagsCollectionName(waitlistId: string): string {
    return `WaitlistUserTags_${waitlistId}`;
}
