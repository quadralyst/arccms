import { TestBed } from '@angular/core/testing';
import { AnalyticsService } from './analytics_service';
import { AnalyticsConnectionStatusService } from './analytics-connection-status.service';
import { Functions } from '@angular/fire/functions';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { signal } from '@angular/core';

vi.mock('@angular/fire/functions', () => ({
    Functions: class { },
    httpsCallable: (functionsInstance: any, name: string) => {
        return (data: any) => Promise.resolve({ data: { metrics: [] } });
    }
}));

describe('AnalyticsService', () => {
    let service: AnalyticsService;
    const mockFunctions = {};
    const mockConnectionStatus = {
        isConnected: signal(true),
        isLoading: signal(false),
        propertyId: signal('123456789'),
        measurementId: signal('G-TEST123'),
        propertyName: signal('Test Property'),
        lastSyncDate: signal(null),
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AnalyticsService,
                { provide: Functions, useValue: mockFunctions },
                { provide: AnalyticsConnectionStatusService, useValue: mockConnectionStatus },
            ],
        });
        service = TestBed.inject(AnalyticsService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should get dashboard data', () => new Promise<void>((done) => {
        service.getDashboardData().subscribe((data) => {
            expect(data).toBeDefined();
            expect(data.metrics).toBeDefined();
            done();
        });
    }));

    it('should return fallback data when no property is connected', () => new Promise<void>((done) => {
        mockConnectionStatus.propertyId.set(null as any);
        service.getDashboardData().subscribe((data) => {
            expect(data).toBeDefined();
            expect(data.metrics).toBeDefined();
            expect(data.lists).toBeDefined();
            // Restore for other tests
            mockConnectionStatus.propertyId.set('123456789');
            done();
        });
    }));
});
