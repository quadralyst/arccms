import { TestBed } from '@angular/core/testing';
import { AnalyticsStore } from './analytics.store';
import { AnalyticsPageService } from './analytics.service';
import { AuthState } from '../../(auth)/auth.store';
import { vi, describe, beforeEach, it, expect } from 'vitest';

describe('AnalyticsStore', () => {
    let store: AnalyticsStore;
    const mockService = {
        getAll: vi.fn(),
        unsubscribeStore: vi.fn()
    };
    const mockAuthStore = {
        currentUser: vi.fn().mockReturnValue({ id: '123' })
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AnalyticsStore,
                { provide: AnalyticsPageService, useValue: mockService },
                { provide: AuthState, useValue: mockAuthStore }
            ],
        });
        store = TestBed.inject(AnalyticsStore);
    });

    it('should be created', () => {
        expect(store).toBeTruthy();
    });
});
