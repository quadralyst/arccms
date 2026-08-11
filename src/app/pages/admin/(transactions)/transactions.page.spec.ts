/**
 * Tests for the admin transactions page.
 *
 * Rendering the real template is the point: it is the only compile check on the
 * table markup, and it covers the `isTest` badge that distinguishes an admin
 * "test this tier" charge from a genuine customer purchase.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import TransactionsPageComponent from './transactions.page';
import { TransactionsStore } from './transactions.store';
import { ITransaction } from './transaction.model';

function txn(overrides: Partial<ITransaction> = {}): ITransaction {
    return {
        userId: 'u1',
        userEmail: 'a@b.com',
        productId: 'p1',
        premiumType: 'gold',
        amount: 49.99,
        currency: 'USD',
        status: 'succeeded',
        type: 'one_time',
        eventType: 'payment.succeeded',
        createdAt: { seconds: 1_700_000_000 },
        ...overrides,
    } as ITransaction;
}

describe('TransactionsPageComponent', () => {
    let component: TransactionsPageComponent;
    let fixture: ComponentFixture<TransactionsPageComponent>;
    let items: ReturnType<typeof signal<ITransaction[]>>;
    let mockStore: { items: unknown; isLoading: unknown; getAll: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        items = signal<ITransaction[]>([]);
        mockStore = { items, isLoading: signal(false), getAll: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [TransactionsPageComponent, NoopAnimationsModule],
            providers: [
                provideRouter([]),
                // BaseComponent injects ActivatedRoute; the page itself reads none of it.
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { params: {}, paramMap: { get: () => null } },
                        paramMap: of({ get: () => null, keys: [] }),
                        queryParams: of({}),
                    },
                },
            ],
        })
            .overrideProvider(TransactionsStore, { useValue: mockStore })
            .compileComponents();

        fixture = TestBed.createComponent(TransactionsPageComponent);
        component = fixture.componentInstance;
    });

    function rows(): string[] {
        return Array.from(fixture.nativeElement.querySelectorAll('tbody tr')).map(
            (tr) => (tr as HTMLElement).textContent ?? '',
        );
    }

    it('should create and load transactions', () => {
        fixture.detectChanges();
        expect(component).toBeTruthy();
        expect(mockStore.getAll).toHaveBeenCalled();
    });

    it('renders a transaction row', () => {
        items.set([txn()]);
        fixture.detectChanges();

        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toContain('a@b.com');
        expect(rows()[0]).toContain('succeeded');
    });

    it('marks an admin test charge with a test badge', () => {
        items.set([txn({ isTest: true })]);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.status-test')).toBeTruthy();
        expect(rows()[0]).toContain('test');
    });

    it('shows no badge on a genuine customer transaction', () => {
        items.set([txn()]);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.status-test')).toBeNull();
    });

    it('filters by status', () => {
        items.set([txn(), txn({ status: 'refunded', userEmail: 'c@d.com' })]);
        component.statusFilter.set('refunded');
        fixture.detectChanges();

        expect(component.filtered()).toHaveLength(1);
        expect(component.filtered()[0].userEmail).toBe('c@d.com');
    });

    it('shows an empty state when there are no transactions', () => {
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('No transactions.');
    });
});
