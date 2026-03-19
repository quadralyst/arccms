import { Injectable } from '@angular/core';
import { createGenericStore } from '../../../../shared/services/generic-store.service';
import { IAnalytics } from './analytics.model';
import { AnalyticsPageService } from './analytics.service';

const AnalyticsStoreBase = createGenericStore<IAnalytics>(AnalyticsPageService);

@Injectable({ providedIn: 'root' })
export class AnalyticsStore extends AnalyticsStoreBase {
    // Add any dashboard-specific methods or computed properties here
}
