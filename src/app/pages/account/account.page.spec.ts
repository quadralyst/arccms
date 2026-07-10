import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import AccountPageComponent from './account.page';
import { AuthState } from '../(auth)/auth.store';
import { MembershipService } from '../payments-ui/membership.service';
import { TransactionsService } from '../admin/(transactions)/transactions.service';

describe('AccountPageComponent', () => {
    let fixture: ComponentFixture<AccountPageComponent>;
    let component: AccountPageComponent;

    const mockAuthState = { currentUser: vi.fn().mockReturnValue(null), logout: vi.fn().mockReturnValue(of(undefined)) };
    const mockMembership = { getById: vi.fn() };
    const mockTransactions = { getAll: vi.fn() };

    async function setup() {
        await TestBed.configureTestingModule({
            imports: [AccountPageComponent],
            providers: [
                provideRouter([]),
                provideNoopAnimations(),
                { provide: AuthState, useValue: mockAuthState },
                { provide: MembershipService, useValue: mockMembership },
                { provide: TransactionsService, useValue: mockTransactions },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(AccountPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockMembership.getById.mockReturnValue(of(null));
        mockTransactions.getAll.mockReturnValue(of({ collectionData: [] }));
    });

    it('prompts to sign in and loads nothing when signed out', async () => {
        mockAuthState.currentUser.mockReturnValue(null);
        await setup();
        expect(component.uid()).toBeNull();
        expect(mockMembership.getById).not.toHaveBeenCalled();
        expect(fixture.nativeElement.textContent).toContain('Please sign in');
    });

    it('loads entitlement and transactions for the signed-in user', async () => {
        mockAuthState.currentUser.mockReturnValue({ uid: 'u1', email: 'qa@example.com' });
        mockMembership.getById.mockReturnValue(of({ uid: 'u1', isPro: true, premiumType: 'gold', premiumStatus: 'active' }));
        mockTransactions.getAll.mockReturnValue(of({ collectionData: [{ id: 't1', userId: 'u1', amount: 49.99, currency: 'USD', status: 'succeeded' }] }));
        await setup();

        expect(mockMembership.getById).toHaveBeenCalledWith('u1');
        expect(mockTransactions.getAll).toHaveBeenCalledWith(
            expect.objectContaining({ whereConditions: [{ field: 'userId', operator: '==', value: 'u1' }] }),
        );
        expect(component.entitlement()?.isPro).toBe(true);
        expect(component.transactions().length).toBe(1);
    });

    it('sorts transactions newest-first regardless of query order', async () => {
        mockAuthState.currentUser.mockReturnValue({ uid: 'u1', email: 'qa@example.com' });
        const older = { id: 'old', userId: 'u1', createdAt: { seconds: 1000 } };
        const newer = { id: 'new', userId: 'u1', createdAt: { seconds: 5000 } };
        mockTransactions.getAll.mockReturnValue(of({ collectionData: [older, newer] }));
        await setup();

        expect(component.transactions().map((t) => t.id)).toEqual(['new', 'old']);
    });
});
