import { TestBed } from '@angular/core/testing';
import { AnalyticsPageService } from './analytics.service';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { vi, describe, beforeEach, it, expect } from 'vitest';

vi.mock('@angular/fire/firestore', () => {
    return {
        Firestore: class { },
        collection: vi.fn(),
        doc: vi.fn(),
        query: vi.fn(),
        where: vi.fn(),
        orderBy: vi.fn(),
        limit: vi.fn(),
        startAfter: vi.fn(),
        endBefore: vi.fn(),
    };
});

describe('AnalyticsPageService', () => {
    let service: AnalyticsPageService;
    const mockFirestore = {};
    const mockAuth = {};

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AnalyticsPageService,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Auth, useValue: mockAuth },
            ],
        });
        service = TestBed.inject(AnalyticsPageService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });
});
