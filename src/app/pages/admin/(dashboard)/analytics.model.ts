import { IBaseModel, OmitCommonFields } from '../../../../shared/models/base-model';

export interface IAnalytics extends IBaseModel {
    id: string;
    metrics?: Array<{
        title: string;
        value: string;
        icon: string;
        change: string;
        changeType: 'positive' | 'negative';
    }>;
    acquisitionPanels?: Array<{
        title: string;
        icon: string;
        items: Array<{ name: string; value: number; percentage: number }>;
    }>;
    dateRange?: {
        startDate: Date;
        endDate: Date;
    };
    lastSyncDate?: Date;
    propertyId?: string;
}

export type AnalyticsData = OmitCommonFields<IAnalytics>;

export const COMPONENT_NAME: string = 'AnalyticsDashboards';
