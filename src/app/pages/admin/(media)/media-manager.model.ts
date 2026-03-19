import { IBaseModel, OmitCommonFields } from '../../../../shared/models/base-model';

export interface IMediaManager extends IBaseModel {
    type: string;
}

export type MediaManagerFormData = OmitCommonFields<IMediaManager>;

export const COMPONENT_NAME: string = 'Media Manager';
