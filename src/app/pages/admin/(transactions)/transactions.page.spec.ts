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
import { headerTestProviders } from '../../../../test/header-test-providers';

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
    let mockStore: { items: unknown; isLoading: unknown; limit: unknown; error: ReturnType<typeof signal<string>>; getAll: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        items = signal<ITransaction[]>([]);
        mockStore = { items, isLoading: signal(false), limit: signal(50), error: signal(''), getAll: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [TransactionsPageComponent, NoopAnimationsModule],
            providers: [
                provideRouter([]),
                // The page header's language menu reaches AuthState → AuthService → Firestore.
                ...headerTestProviders(),
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
        // The status in the admin's language, not the stored word.
        expect(rows()[0]).toContain('Succeeded');
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

    it('filters by status on the server, and All reads everything again', () => {
        component.onStatusChange('refunded');
        expect(component.statusFilter()).toBe('refunded');
        expect(mockStore.getAll).toHaveBeenLastCalledWith(expect.objectContaining({
            limitCount: 50,
            currentPageNumber: 0,
            whereConditions: [{ field: 'status', operator: '==', value: 'refunded' }],
        }));

        component.onStatusChange('');
        expect(mockStore.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ whereConditions: [] }));
    });

    it('a filter whose index is missing says so, with its link, rather than "no transactions"', () => {
        mockStore.error.set('The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=abc');
        fixture.detectChanges();

        const alert = fixture.nativeElement.querySelector('.alert-warning');
        expect(alert).not.toBeNull();
        expect(alert.querySelector('a').getAttribute('href')).toContain('https://console.firebase.google.com/');
    });

    it('shows an empty state when there are no transactions', () => {
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('No transactions.');
    });

    it('a read that fails says so in plain words, with Retry, not "no transactions"', () => {
        mockStore.error.set('FirebaseError: [code=unavailable]: Failed to get document because the client is offline.');
        fixture.detectChanges();

        const alert = fixture.nativeElement.querySelector('.alert-danger');
        expect(alert).not.toBeNull();
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.textContent).toContain('This list did not load');
        expect(fixture.nativeElement.textContent).not.toContain('FirebaseError');
        expect(fixture.nativeElement.textContent).not.toContain('No transactions.');

        component.statusFilter.set('failed');
        mockStore.getAll.mockClear();
        (alert.querySelector('button') as HTMLButtonElement).click();
        expect(mockStore.getAll).toHaveBeenCalledWith(expect.objectContaining({
            whereConditions: [{ field: 'status', operator: '==', value: 'failed' }],
        }));
    });

    it('a filter with no rows says nothing matches, and Clear filters reads everything again', () => {
        component.statusFilter.set('refunded');
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain('No transactions match this filter.');
        const clear = [...fixture.nativeElement.querySelectorAll('button')].find((b: HTMLButtonElement) => b.textContent!.includes('Clear filters')) as HTMLButtonElement;
        clear.click();
        expect(component.statusFilter()).toBe('');
        expect(mockStore.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ whereConditions: [] }));
    });
});
