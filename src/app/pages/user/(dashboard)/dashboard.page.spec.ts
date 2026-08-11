import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Functions } from '@angular/fire/functions';
import { of } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import UsersDashboardComponent from './dashboard.page';
import { AuthState } from '../../(auth)/auth.store';
import { MembershipService } from '../../payments-ui/membership.service';
import { TransactionsService } from '../../admin/(transactions)/transactions.service';
import { CreditLedgerService } from '../../payments-ui/credit-ledger.service';

describe('UsersDashboardComponent', () => {
    let fixture: ComponentFixture<UsersDashboardComponent>;

    const mockAuth = {
        currentUser: vi.fn().mockReturnValue({ uid: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' }),
        logout: vi.fn().mockReturnValue(of(undefined)),
    };
    const mockMembership = { getById: vi.fn().mockReturnValue(of({ uid: 'u1', isPro: false })) };
    const mockTransactions = { getAll: vi.fn().mockReturnValue(of({ collectionData: [] })) };
    const mockLedger = { getAll: vi.fn().mockReturnValue(of({ collectionData: [] })) };

    async function setup() {
        await TestBed.configureTestingModule({
            imports: [UsersDashboardComponent],
            providers: [
                provideRouter([]),
                provideNoopAnimations(),
                { provide: AuthState, useValue: mockAuth },
                { provide: MembershipService, useValue: mockMembership },
                { provide: TransactionsService, useValue: mockTransactions },
                { provide: CreditLedgerService, useValue: mockLedger },
                { provide: Functions, useValue: {} },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(UsersDashboardComponent);
        fixture.detectChanges();
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockMembership.getById.mockReturnValue(of({ uid: 'u1', isPro: false }));
        mockTransactions.getAll.mockReturnValue(of({ collectionData: [] }));
        mockLedger.getAll.mockReturnValue(of({ collectionData: [] }));
    });

    it('greets the user by first name', async () => {
        await setup();
        expect(fixture.nativeElement.textContent).toContain('Welcome back, Ada');
    });

    it('shows the onboarding empty state for a brand-new free user', async () => {
        await setup();
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('Get started');
        expect(text).toContain('No activity yet');
        expect(text).not.toContain('Premium tools unlocked');
    });

    it('renders merged recent activity (transactions + credits), newest first', async () => {
        mockMembership.getById.mockReturnValue(of({ uid: 'u1', isPro: true, premiumType: 'gold', creditBalance: 5 }));
        mockTransactions.getAll.mockReturnValue(
            of({ collectionData: [{ id: 't1', userId: 'u1', status: 'succeeded', type: 'subscription', premiumType: 'gold', amount: 49.99, currency: 'USD', createdAt: { seconds: 100 } }] }),
        );
        mockLedger.getAll.mockReturnValue(
            of({ collectionData: [{ id: 'l1', userId: 'u1', reason: 'purchase', delta: 100, balanceAfter: 100, createdAt: { seconds: 500 } }] }),
        );
        await setup();

        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('Recent activity');
        expect(text).toContain('Credits · purchase');
        expect(text).toContain('succeeded · gold');
        expect(text).not.toContain('Get started'); // not a new user
        // credit entry (seconds:500) is newer than the txn (seconds:100)
        expect((fixture.componentInstance as any).activity()[0].id).toBe('led:l1');
    });
});
