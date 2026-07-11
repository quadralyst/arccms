import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { EntitlementService } from './entitlement.service';
import { MembershipService } from '../payments-ui/membership.service';
import { AuthState } from '../(auth)/auth.store';

describe('EntitlementService', () => {
    const mockMembership = { getById: vi.fn() };
    const mockAuth = { currentUser: vi.fn().mockReturnValue(null) };

    function make() {
        TestBed.configureTestingModule({
            providers: [
                EntitlementService,
                { provide: MembershipService, useValue: mockMembership },
                { provide: AuthState, useValue: mockAuth },
            ],
        });
        return TestBed.inject(EntitlementService);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        TestBed.resetTestingModule();
    });

    it('defaults to a signed-out / free state', () => {
        const svc = make();
        expect(svc.isPro()).toBe(false);
        expect(svc.tierRank()).toBe(-1);
        expect(svc.creditBalance()).toBe(0);
    });

    it('loads a Pro user into the signals', () => {
        mockMembership.getById.mockReturnValue(of({ uid: 'u1', isPro: true, premiumType: 'gold', premiumTierRank: 2, creditBalance: 7 }));
        const svc = make();
        svc.load('u1').subscribe();

        expect(mockMembership.getById).toHaveBeenCalledWith('u1');
        expect(svc.isPro()).toBe(true);
        expect(svc.premiumType()).toBe('gold');
        expect(svc.tierRank()).toBe(2);
        expect(svc.creditBalance()).toBe(7);
    });

    it('hasTier() respects the minimum rank', () => {
        mockMembership.getById.mockReturnValue(of({ uid: 'u1', isPro: true, premiumTierRank: 2 }));
        const svc = make();
        svc.load('u1').subscribe();
        expect(svc.hasTier(2)).toBe(true);
        expect(svc.hasTier(3)).toBe(false);
    });

    it('load() with no uid resolves to null without calling the service', () => {
        const svc = make();
        let result: unknown = 'x';
        svc.load().subscribe((r) => (result = r));
        expect(result).toBeNull();
        expect(mockMembership.getById).not.toHaveBeenCalled();
    });
});
