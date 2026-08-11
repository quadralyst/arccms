/**
 * Tests for JoinedUsersComponent
 *
 * Covers: stats computation, pagination, navigation, delete flow
 * (batch write logic, count decrements, referrer cleanup, UI signal update).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Firestore } from '@angular/fire/firestore';
import * as FirestoreSDK from '@angular/fire/firestore';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import JoinedUsersComponent from './joined-users.page';
import { WaitlistUserTagsStore } from './waitlist-user-tags.store';

// ---------------------------------------------------------------------------
// Module-level Firestore mock (hoisted by Vitest before any imports)
// ---------------------------------------------------------------------------

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    collection: vi.fn(),
    getDocs: vi.fn(),
    orderBy: vi.fn(),
    query: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    writeBatch: vi.fn(),
    increment: vi.fn((n: number) => n),
    arrayRemove: vi.fn((val: string) => ({ __arrayRemove: val })),
    where: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<any> = {}): any {
    return {
        id: 'user-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        emailVerified: true,
        isConfirmed: true,
        queuePosition: 1,
        totalReferrals: 0,
        referralCode: 'ALICE123',
        signupTimestamp: { toDate: () => new Date('2025-01-01') },
        tags: [],
        waitlistedUserId: 'wlu-1',
        referredBy: undefined,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tag store mock
// ---------------------------------------------------------------------------

class MockTagsStore {
    items = signal<any[]>([]);
    isLoading = signal(false);
    totalRecords = signal(0);
    setWaitlistId = vi.fn();
    getAll = vi.fn();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('JoinedUsersComponent', () => {
    let component: JoinedUsersComponent;
    let fixture: ComponentFixture<JoinedUsersComponent>;
    let batchMock: { delete: any; update: any; commit: any };

    const mockRouter = { navigate: vi.fn().mockResolvedValue(true) };
    const mockRoute = {
        snapshot: {
            paramMap: { get: vi.fn().mockReturnValue('wl-1') },
            queryParamMap: { get: vi.fn().mockReturnValue(null) },
        },
    };

    function resetBatchMock() {
        batchMock = {
            delete: vi.fn(),
            update: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined),
        };
        vi.mocked(FirestoreSDK.writeBatch).mockReturnValue(batchMock as any);
    }

    beforeEach(async () => {
        resetBatchMock();

        // Default stubs for Firestore builder fns
        vi.mocked(FirestoreSDK.collection).mockReturnValue({} as any);
        vi.mocked(FirestoreSDK.doc).mockReturnValue({} as any);
        vi.mocked(FirestoreSDK.query).mockReturnValue({} as any);
        vi.mocked(FirestoreSDK.where).mockReturnValue({} as any);
        vi.mocked(FirestoreSDK.orderBy).mockReturnValue({} as any);

        // Default: getDocs returns empty snapshot
        vi.mocked(FirestoreSDK.getDocs).mockResolvedValue({
            empty: true, docs: [], forEach: vi.fn(),
        } as any);

        // Default: getDoc returns a doc whose waitlistId matches 'wl-1'
        vi.mocked(FirestoreSDK.getDoc).mockResolvedValue({
            exists: () => true,
            data: () => ({ waitlistId: 'wl-1', waitlistIds: ['wl-1'] }),
        } as any);

        await TestBed.configureTestingModule({
            imports: [JoinedUsersComponent, NoopAnimationsModule],
            providers: [
                { provide: Firestore, useValue: {} },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockRoute },
                { provide: WaitlistUserTagsStore, useClass: MockTagsStore },
            ],
            // NO_ERRORS_SCHEMA suppresses unknown child component/directive errors
            schemas: [NO_ERRORS_SCHEMA],
        }).compileComponents();

        fixture = TestBed.createComponent(JoinedUsersComponent);
        component = fixture.componentInstance;

        // Pre-set state so ngOnInit's Firestore calls don't interfere
        component.waitlistId.set('wl-1');
        component.users.set([makeUser()]);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // -----------------------------------------------------------------------
    // Basic creation
    // -----------------------------------------------------------------------

    describe('Component creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('waitlistId signal should be a string', () => {
            expect(typeof component.waitlistId()).toBe('string');
        });
    });

    // -----------------------------------------------------------------------
    // Stats computed signals
    // -----------------------------------------------------------------------

    describe('Stats signals', () => {
        it('should count total users', () => {
            component.users.set([makeUser(), makeUser({ id: 'user-2' })]);
            expect(component.totalUsers()).toBe(2);
        });

        it('should count only confirmed users', () => {
            component.users.set([
                makeUser({ isConfirmed: true }),
                makeUser({ id: 'user-2', isConfirmed: false }),
            ]);
            expect(component.verifiedUsers()).toBe(1);
        });

        it('should sum totalReferrals across all users', () => {
            component.users.set([
                makeUser({ totalReferrals: 3 }),
                makeUser({ id: 'user-2', totalReferrals: 5 }),
            ]);
            expect(component.totalReferrals()).toBe(8);
        });
    });

    // -----------------------------------------------------------------------
    // Pagination
    // -----------------------------------------------------------------------

    describe('Pagination', () => {
        it('should slice users for current page', () => {
            component.users.set(
                Array.from({ length: 15 }, (_, i) => makeUser({ id: `u${i}`, email: `u${i}@x.com` }))
            );
            component.pageSize.set(10);
            component.currentPage.set(0);
            expect(component.paginatedUsers().length).toBe(10);
        });

        it('should show remaining users on page 2', () => {
            component.users.set(
                Array.from({ length: 15 }, (_, i) => makeUser({ id: `u${i}`, email: `u${i}@x.com` }))
            );
            component.pageSize.set(10);
            component.currentPage.set(1);
            expect(component.paginatedUsers().length).toBe(5);
        });

        it('getStartRecord should be 1 on first page', () => {
            component.currentPage.set(0);
            component.pageSize.set(10);
            expect(component.getStartRecord()).toBe(1);
        });

        it('getEndRecord should cap at totalUsers', () => {
            component.users.set(
                Array.from({ length: 3 }, (_, i) => makeUser({ id: `u${i}`, email: `u${i}@x.com` }))
            );
            component.pageSize.set(10);
            component.currentPage.set(0);
            expect(component.getEndRecord()).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Navigation
    // -----------------------------------------------------------------------

    describe('goBack()', () => {
        it('should navigate to /admin/waitlists', () => {
            component.goBack();
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/waitlists']);
        });
    });

    // -----------------------------------------------------------------------
    // onUserUpdated
    // -----------------------------------------------------------------------

    describe('onUserUpdated()', () => {
        it('should replace the matching user in the list', () => {
            const original = makeUser();
            component.users.set([original]);
            component.onUserUpdated({ ...original, totalReferrals: 10 });
            expect(component.users()[0].totalReferrals).toBe(10);
        });

        it('should leave other users unchanged', () => {
            const u1 = makeUser({ id: 'u1' });
            const u2 = makeUser({ id: 'u2', email: 'bob@x.com' });
            component.users.set([u1, u2]);
            component.onUserUpdated({ ...u1, totalReferrals: 99 });
            expect(component.users()[1].id).toBe('u2');
        });
    });

    // -----------------------------------------------------------------------
    // deleteUser — confirmation cancelled
    // -----------------------------------------------------------------------

    describe('deleteUser() — confirmation cancelled', () => {
        it('should not call batch.commit when user cancels', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(false);
            await component.deleteUser(makeUser());
            expect(batchMock.commit).not.toHaveBeenCalled();
        });

        it('should not remove user from list when cancelled', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(false);
            component.users.set([makeUser()]);
            await component.deleteUser(makeUser());
            expect(component.users().length).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // deleteUser — unverified user (no count decrement)
    // -----------------------------------------------------------------------

    describe('deleteUser() — unconfirmed user', () => {
        const unverified = () =>
            makeUser({ isConfirmed: false, referredBy: undefined, waitlistedUserId: undefined });

        it('should delete the subcollection doc', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            await component.deleteUser(unverified());
            expect(batchMock.delete).toHaveBeenCalledTimes(1);
        });

        it('should NOT decrement totalSignups for unverified user', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            await component.deleteUser(unverified());
            expect(batchMock.update).not.toHaveBeenCalled();
        });

        it('should commit the batch', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            await component.deleteUser(unverified());
            expect(batchMock.commit).toHaveBeenCalledOnce();
        });

        it('should remove user from local signal', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            component.users.set([unverified()]);
            await component.deleteUser(unverified());
            expect(component.users().length).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // deleteUser — verified user (totalSignups decremented)
    // -----------------------------------------------------------------------

    describe('deleteUser() — confirmed user', () => {
        const verified = () =>
            makeUser({ isConfirmed: true, referredBy: undefined, waitlistedUserId: undefined });

        it('should decrement totalSignups on the waitlist doc', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            await component.deleteUser(verified());
            expect(batchMock.update).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ totalSignups: -1 })
            );
        });

        it('should delete the subcollection doc', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            await component.deleteUser(verified());
            expect(batchMock.delete).toHaveBeenCalledTimes(1);
        });

        it('should commit the batch exactly once', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            await component.deleteUser(verified());
            expect(batchMock.commit).toHaveBeenCalledOnce();
        });

        it('should remove user from local signal', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            component.users.set([verified()]);
            await component.deleteUser(verified());
            expect(component.users().length).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // deleteUser — user with referrer
    // -----------------------------------------------------------------------

    describe('deleteUser() — referral reversal is the trigger\'s job (U6)', () => {
        // This page used to reverse the referral itself: find the referrer in the global
        // registry, decrement their count on BOTH the registry doc and the member doc, and
        // delete the referral record. `onWaitlistUserDelete` already does that server-side
        // via decrementReferralCounts — so the referrer's totalReferrals was decremented
        // twice per deletion, and the extra work read a collection U6 has frozen.
        it('deletes the member and leaves the referral counters alone', async () => {
            const user = {
                id: 'user-1', email: 'a@b.com', firstName: 'A', isConfirmed: true,
                referredBy: 'REF123', waitlistedUserId: 'wl-1',
            } as any;
            component.users.set([user]);
            component.waitlistId.set('waitlist-1');

            await component.deleteUser(user);

            // The member doc is deleted and the form's signup count adjusted; nothing
            // touches totalReferrals or the referrals subcollection.
            expect(batchMock.delete).toHaveBeenCalled();
            const updates = batchMock.update.mock.calls.map((c: any[]) => Object.keys(c[1] || {})).flat();
            expect(updates).not.toContain('totalReferrals');
        });

        it('no longer reads the global registry', async () => {
            const user = {
                id: 'user-1', email: 'a@b.com', isConfirmed: false,
                referredBy: 'REF123', waitlistedUserId: 'wl-1',
            } as any;
            component.users.set([user]);
            component.waitlistId.set('waitlist-1');

            await component.deleteUser(user);

            const paths = [
                ...vi.mocked(FirestoreSDK.collection).mock.calls.map((c: any[]) => String(c[1])),
                ...vi.mocked(FirestoreSDK.doc).mock.calls.map((c: any[]) => String(c[1])),
            ];
            expect(paths.some((p) => p.includes('WaitlistedUsers'))).toBe(false);
        });

        it('removes the user from the local list without a reload', async () => {
            const user = { id: 'user-1', email: 'a@b.com', isConfirmed: false } as any;
            component.users.set([user, { id: 'user-2', email: 'c@d.com' } as any]);
            component.waitlistId.set('waitlist-1');

            await component.deleteUser(user);

            expect(component.users().map((u: any) => u.id)).toEqual(['user-2']);
        });
    });


    // -----------------------------------------------------------------------
    // deleteUser — error handling
    // -----------------------------------------------------------------------

    describe('deleteUser() — error handling', () => {
        it('should show alert when batch.commit rejects', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
            batchMock.commit.mockRejectedValue(new Error('Permission denied'));
            await component.deleteUser(
                makeUser({ emailVerified: false, isConfirmed: false, referredBy: undefined, waitlistedUserId: undefined })
            );
            expect(alertSpy).toHaveBeenCalled();
        });

        it('should reset isDeleting to false after error', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            vi.spyOn(window, 'alert').mockImplementation(() => undefined);
            batchMock.commit.mockRejectedValue(new Error('Permission denied'));
            await component.deleteUser(
                makeUser({ emailVerified: false, isConfirmed: false, referredBy: undefined, waitlistedUserId: undefined })
            );
            expect(component.isDeleting()).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Table column config
    // -----------------------------------------------------------------------

    describe('Table column config', () => {
        beforeEach(() => component.initColumns());

        it('should have an actions column', () => {
            const col = component.tableColumns.find(c => c.key === 'actions');
            expect(col).toBeDefined();
        });

        it('should have a view action', () => {
            const col = component.tableColumns.find(c => c.key === 'actions');
            const action = col?.actions?.find((a: any) => a.action === 'view');
            expect(action).toBeDefined();
        });

        it('should have a delete action with trash icon', () => {
            const col = component.tableColumns.find(c => c.key === 'actions');
            const action = col?.actions?.find((a: any) => a.action === 'delete');
            expect(action).toBeDefined();
            expect(action?.icon).toContain('fa-trash');
        });
    });
});
