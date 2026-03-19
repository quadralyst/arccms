import { Injectable } from '@angular/core';
import { DbService } from '../../../../shared/services/db.service';
import { IAnalytics } from './analytics.model';

@Injectable({
    providedIn: 'root',
})
export class AnalyticsPageService extends DbService<IAnalytics> {
    constructor() {
        super('AnalyticsDashboards');
    }
}
