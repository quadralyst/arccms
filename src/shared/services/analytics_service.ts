// analytics.service.ts - Updated for Firebase Functions v2 onCall
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AnalyticsConnectionStatusService } from './analytics-connection-status.service';

export interface DateRange {
    startDate: string;
    endDate: string;
}

export interface MetricCard {
    title: string;
    value: string;
    icon: string;
    change: string;
    changeType: 'positive' | 'negative';
}

export interface ListItem {
    name: string;
    value: string;
    percentage: number;
}

export interface ListCard {
    title: string;
    icon: string;
    items: ListItem[];
}

export interface AnalyticsDashboard {
    metrics: MetricCard[];
    lists: ListCard[];
}

@Injectable({
    providedIn: 'root',
})
export class AnalyticsService {
    private functions = inject(Functions);
    private connectionStatus = inject(AnalyticsConnectionStatusService);
    private getAnalyticsDashboard = httpsCallable(this.functions, 'getAnalyticsDashboard');
    private debugAnalytics = httpsCallable(this.functions, 'debugAnalytics');

    getDebugAnalytics(): Observable<any> {
        const propertyId = this.connectionStatus.propertyId();
        if (!propertyId) {
            return of({ success: false, error: 'No analytics property connected. Go to Settings > Analytics to connect.' });
        }
        return from(this.debugAnalytics({ propertyId })).pipe(
            map((result) => result.data),
            catchError((error) => {
                console.error('Debug Analytics Function Error:', error);
                return of({ success: false, error: error.message || 'Function call failed' });
            }),
        );
    }

    getDashboardData(dateRange?: DateRange): Observable<any> {
        const propertyId = this.connectionStatus.propertyId();
        if (!propertyId) {
            return of(this.getFallbackData());
        }
        const requestData = {
            dateRange: dateRange || {
                startDate: '2daysAgo',
                endDate: 'today',
            },
            propertyId,
        };

        return from(this.getAnalyticsDashboard(requestData)).pipe(
            map((result: any) => {
                // return result.data;
                const data = result.data;
                return {
                    actualResponse: data.actualResponse,
                    metrics: data.metrics || this.getFallbackMetrics(),
                    lists: [
                        {
                            title: 'Top Pages',
                            icon: 'fas fa-file-alt',
                            items: data.topPages || this.getFallbackPages(),
                        },
                        {
                            title: 'Traffic Sources',
                            icon: 'fas fa-globe',
                            items: data.trafficSources || this.getFallbackSources(),
                        },
                        {
                            title: 'Device Types',
                            icon: 'fas fa-mobile-alt',
                            items: data.devices || this.getFallbackDevices(),
                        },
                        {
                            title: 'Top Countries',
                            icon: 'fas fa-map-marker-alt',
                            items: data.countries || this.getFallbackCountries(),
                        },
                    ],
                };
            }),
            catchError((error) => {
                console.error('Analytics Function Error:', error);
                return of(this.getFallbackData());
            }),
        );
    }

    // Keep all your existing fallback methods...
    private getFallbackData(): AnalyticsDashboard {
        return {
            metrics: this.getFallbackMetrics(),
            lists: [
                {
                    title: 'Top Pages',
                    icon: 'fas fa-file-alt',
                    items: this.getFallbackPages(),
                },
                {
                    title: 'Traffic Sources',
                    icon: 'fas fa-globe',
                    items: this.getFallbackSources(),
                },
                {
                    title: 'Device Types',
                    icon: 'fas fa-mobile-alt',
                    items: this.getFallbackDevices(),
                },
                {
                    title: 'Top Countries',
                    icon: 'fas fa-map-marker-alt',
                    items: this.getFallbackCountries(),
                },
            ],
        };
    }

    private getFallbackMetrics(): MetricCard[] {
        return [
            { title: 'Total Sessions', value: '1,234', icon: 'fas fa-users', change: '+12.5%', changeType: 'positive' },
            { title: 'Total Users', value: '987', icon: 'fas fa-user-friends', change: '+8.2%', changeType: 'positive' },
            { title: 'Bounce Rate', value: '42.3%', icon: 'fas fa-chart-line', change: '-2.1%', changeType: 'negative' },
            { title: 'Avg. Session', value: '2m 34s', icon: 'fas fa-clock', change: '+15.3%', changeType: 'positive' },
            { title: 'Page Views', value: '5,678', icon: 'fas fa-eye', change: '+7.8%', changeType: 'positive' },
            { title: 'New Users', value: '456', icon: 'fas fa-user-plus', change: '+18.4%', changeType: 'positive' },
        ];
    }

    private getFallbackPages(): ListItem[] {
        return [
            { name: 'Home Page', value: '1,847', percentage: 100 },
            { name: 'About Us', value: '1,234', percentage: 67 },
            { name: 'Services', value: '987', percentage: 53 },
            { name: 'Contact', value: '756', percentage: 41 },
        ];
    }

    private getFallbackSources(): ListItem[] {
        return [
            { name: 'Google', value: '2,341', percentage: 100 },
            { name: 'Direct', value: '1,567', percentage: 67 },
            { name: 'Social Media', value: '892', percentage: 38 },
            { name: 'Email', value: '543', percentage: 23 },
        ];
    }

    private getFallbackDevices(): ListItem[] {
        return [
            { name: 'Desktop', value: '2,847', percentage: 100 },
            { name: 'Mobile', value: '1,934', percentage: 68 },
            { name: 'Tablet', value: '432', percentage: 15 },
        ];
    }

    private getFallbackCountries(): ListItem[] {
        return [
            { name: 'United States', value: '1,847', percentage: 100 },
            { name: 'United Kingdom', value: '892', percentage: 48 },
            { name: 'Canada', value: '567', percentage: 31 },
            { name: 'Australia', value: '234', percentage: 13 },
        ];
    }
}
