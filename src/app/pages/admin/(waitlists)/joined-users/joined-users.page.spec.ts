/**
 * Tests for JoinedUsersComponent
 *
 * Covers: aggregate totals, cursor paging (one read per page, never the whole
 * collection), the load error with Retry, navigation, and the delete flow
 * (batch write logic, count decrements, the page read again).
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
import { ConfirmService } from '../../../../../shared/components/confirmation-popup/confirm.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { headerTestProviders } from '../../../../../test/header-test-providers';

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
    limit: vi.fn((n: number) => ({ __limit: n })),
    startAfter: vi.fn((d: unknown) => ({ __startAfter: d })),
    getCountFromServer: vi.fn(),
}));

/** A query snapshot of these sign-ups, as getDocs returns it. */
function snap(users: any[]): any {
    return { empty: users.length === 0, docs: users.map((u) => ({ id: u.id, data: () => u })) };
}

/** The sign-ups `n` of them, newest first. */
function many(n: number): any[] {
    return Array.from({ length: n }, (_, i) => ({
        id: `u${i}`, email: `u${i}@x.com`, firstName: `U${i}`, isConfirmed: i % 2 === 0,
        signupTimestamp: { toDate: () => new Date(2025, 0, 1) },
    }));
}

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
        signupTimestamp: { toDate: () => new Date('2025-01-01') },
        tags: [],
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
    // Arc CMS's own dialog, in place of the browser's confirm() (RF4, 4.10).
    const confirmDialog = { ask: vi.fn(async () => true) };
    const notify = { error: vi.fn(), success: vi.fn() };

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
        vi.mocked(FirestoreSDK.getDocs).mockResolvedValue(snap([]));
        vi.mocked(FirestoreSDK.getCountFromServer).mockResolvedValue({ data: () => ({ count: 0 }) } as any);

        // Default: getDoc returns a doc whose waitlistId matches 'wl-1'
        vi.mocked(FirestoreSDK.getDoc).mockResolvedValue({
            exists: () => true,
            data: () => ({ waitlistId: 'wl-1', waitlistIds: ['wl-1'] }),
        } as any);

        await TestBed.configureTestingModule({
            imports: [JoinedUsersComponent, NoopAnimationsModule],
            providers: [
                // <arc-page-header> renders once change detection runs (zoneless).
                ...headerTestProviders(),
                { provide: Firestore, useValue: {} },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockRoute },
                { provide: WaitlistUserTagsStore, useClass: MockTagsStore },
                { provide: ConfirmService, useValue: confirmDialog },
                { provide: NotifyService, useValue: notify },
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

    describe('Totals (RF5, 5.10)', () => {
        it('counts all sign-ups and the confirmed ones with aggregate counts, not by reading them', async () => {
            vi.mocked(FirestoreSDK.getCountFromServer)
                .mockResolvedValueOnce({ data: () => ({ count: 1234 }) } as any)
                .mockResolvedValueOnce({ data: () => ({ count: 1000 }) } as any);
            await component.loadCounts();
            expect(component.totalUsers()).toBe(1234);
            expect(component.verifiedUsers()).toBe(1000);
            expect(FirestoreSDK.where).toHaveBeenCalledWith('isConfirmed', '==', true);
            expect(FirestoreSDK.getDocs).not.toHaveBeenCalled();
        });

        // Signup forms have no referrals or queue (specs/form-gamification-spec.md).
        it('has no referral total, and no Position or Referrals column', () => {
            expect((component as any).totalReferrals).toBeUndefined();
            component.initColumns();
            const keys = (component.tableColumns || []).map((c: any) => c.key);
            expect(keys).not.toContain('queuePosition');
            expect(keys).not.toContain('totalReferrals');
        });
    });

    // -----------------------------------------------------------------------
    // Paging (RF5, 5.10): one read of a page, never the whole collection
    // -----------------------------------------------------------------------

    describe('Paging', () => {
        const all = many(25);
        /** A tiny Firestore: answers a query from its startAfter and limit, newest first. */
        function serve(): void {
            vi.mocked(FirestoreSDK.query).mockImplementation(((...args: any[]) => ({ args })) as any);
            vi.mocked(FirestoreSDK.getDocs).mockImplementation((async (q: any) => {
                const parts = q?.args ?? [];
                const after = parts.find((p: any) => p?.__startAfter)?.__startAfter;
                const max = parts.find((p: any) => p?.__limit)?.__limit ?? all.length;
                const from = after ? all.findIndex((u) => u.id === after.id) + 1 : 0;
                return snap(all.slice(from, from + max));
            }) as any);
        }
        beforeEach(() => {
            serve();
            component.pageSize.set(10);
        });

        it('reads only the first page, newest first', async () => {
            await component.loadPage();
            expect(FirestoreSDK.limit).toHaveBeenCalledWith(10);
            expect(FirestoreSDK.orderBy).toHaveBeenCalledWith('signupTimestamp', 'desc');
            expect(FirestoreSDK.startAfter).not.toHaveBeenCalled();
            expect(component.paginatedUsers().map((u) => u.id)).toEqual(all.slice(0, 10).map((u) => u.id));
        });

        it('starts the next page after the last sign-up of the page before', async () => {
            await component.loadPage();
            component.currentPage.set(1);
            await component.loadPage();
            expect((vi.mocked(FirestoreSDK.startAfter).mock.calls.at(-1)![0] as any).id).toBe('u9');
            expect(FirestoreSDK.limit).toHaveBeenLastCalledWith(10);
            expect(component.paginatedUsers()[0].id).toBe('u10');
        });

        it('a jump to a page not read yet reads up to it once, then shows only that page', async () => {
            component.currentPage.set(2);
            await component.loadPage();
            expect(FirestoreSDK.limit).toHaveBeenCalledWith(30);
            expect(component.paginatedUsers().map((u) => u.id)).toEqual(['u20', 'u21', 'u22', 'u23', 'u24']);

            // Going back a page now starts after the remembered end of page 0.
            component.currentPage.set(1);
            await component.loadPage();
            expect((vi.mocked(FirestoreSDK.startAfter).mock.calls.at(-1)![0] as any).id).toBe('u9');
            expect(component.paginatedUsers()[0].id).toBe('u10');
        });

        it('shows the page asked for last when an older read answers late', async () => {
            let answerFirst!: (v: unknown) => void;
            vi.mocked(FirestoreSDK.getDocs).mockImplementationOnce((() => new Promise((r) => { answerFirst = r; })) as any);
            const first = component.loadPage();
            component.currentPage.set(2);
            await component.loadPage();
            answerFirst(snap(all.slice(0, 10)));
            await first;
            expect(component.paginatedUsers()[0].id).toBe('u20');
            expect(component.loading()).toBe(false);
        });

        it('a new page size starts the paging over', async () => {
            await component.loadPage();
            const load = vi.spyOn(component, 'loadPage');
            component.onPageChange({ pageIndex: 0, pageSize: 25, length: 25 } as any);
            await load.mock.results[0].value;
            expect(FirestoreSDK.limit).toHaveBeenLastCalledWith(25);
            expect(component.paginatedUsers().length).toBe(25);
        });

        it('getStartRecord should be 1 on first page', () => {
            component.currentPage.set(0);
            component.pageSize.set(10);
            expect(component.getStartRecord()).toBe(1);
        });

        it('getEndRecord counts the rows on the page, capped at the total', () => {
            component.users.set(many(3));
            component.totalUsers.set(3);
            component.pageSize.set(10);
            component.currentPage.set(0);
            expect(component.getEndRecord()).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Load error and Retry (RF5, 5.1)
    // -----------------------------------------------------------------------

    describe('Load error', () => {
        it('marks the list as not loaded, keeping the detail in the console', async () => {
            const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            vi.mocked(FirestoreSDK.getDocs).mockRejectedValueOnce(new Error('permission-denied'));
            await component.loadPage();
            expect(component.loadError()).toBe(true);
            expect(component.loading()).toBe(false);
            expect(log).toHaveBeenCalled();
        });

        it('Retry reads the totals and the page again, and clears the error', async () => {
            component.loadError.set(true);
            vi.mocked(FirestoreSDK.getDocs).mockResolvedValueOnce(snap(many(2)));
            await component.loadUsers();
            expect(component.loadError()).toBeNull();
            expect(FirestoreSDK.getCountFromServer).toHaveBeenCalledTimes(2);
            expect(component.paginatedUsers().length).toBe(2);
        });

        it('passes the error and Retry to the table', () => {
            fixture.detectChanges();
            component.loadError.set(true);
            fixture.detectChanges();
            const table = fixture.debugElement.query((el) => el.name === 'app-global-table');
            expect(table.componentInstance.error).toBe(true);
            const retry = vi.spyOn(component, 'loadUsers').mockResolvedValue(undefined);
            table.componentInstance.retry.emit();
            expect(retry).toHaveBeenCalled();
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
            component.onUserUpdated({ ...original, firstName: 'Alicia' });
            expect(component.users()[0].firstName).toBe('Alicia');
        });

        it('should leave other users unchanged', () => {
            const u1 = makeUser({ id: 'u1' });
            const u2 = makeUser({ id: 'u2', email: 'bob@x.com' });
            component.users.set([u1, u2]);
            component.onUserUpdated({ ...u1, firstName: 'Changed' });
            expect(component.users()[1].id).toBe('u2');
        });
    });

    // -----------------------------------------------------------------------
    // deleteUser — confirmation cancelled
    // -----------------------------------------------------------------------

    describe('deleteUser() — confirmation cancelled', () => {
        it('should not call batch.commit when user cancels', async () => {
            confirmDialog.ask.mockResolvedValueOnce(false);
            await component.deleteUser(makeUser());
            expect(batchMock.commit).not.toHaveBeenCalled();
        });

        it('should not remove user from list when cancelled', async () => {
            confirmDialog.ask.mockResolvedValueOnce(false);
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
            makeUser({ isConfirmed: false });

        it('should delete the subcollection doc', async () => {
            await component.deleteUser(unverified());
            expect(batchMock.delete).toHaveBeenCalledTimes(1);
        });

        it('should NOT decrement totalSignups for unverified user', async () => {
            await component.deleteUser(unverified());
            expect(batchMock.update).not.toHaveBeenCalled();
        });

        it('should commit the batch', async () => {
            await component.deleteUser(unverified());
            expect(batchMock.commit).toHaveBeenCalledOnce();
        });

        it('reads the page again, without the deleted sign-up', async () => {
            component.users.set([unverified()]);
            await component.deleteUser(unverified());
            expect(component.users().length).toBe(0);
        });

        it('takes one off the total, not off the confirmed count', async () => {
            component.totalUsers.set(5);
            component.verifiedUsers.set(3);
            await component.deleteUser(unverified());
            expect(component.totalUsers()).toBe(4);
            expect(component.verifiedUsers()).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // deleteUser — verified user (totalSignups decremented)
    // -----------------------------------------------------------------------

    describe('deleteUser() — confirmed user', () => {
        const verified = () =>
            makeUser({ isConfirmed: true });

        it('should decrement totalSignups on the waitlist doc', async () => {
            await component.deleteUser(verified());
            expect(batchMock.update).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ totalSignups: -1 })
            );
        });

        it('should delete the subcollection doc', async () => {
            await component.deleteUser(verified());
            expect(batchMock.delete).toHaveBeenCalledTimes(1);
        });

        it('should commit the batch exactly once', async () => {
            await component.deleteUser(verified());
            expect(batchMock.commit).toHaveBeenCalledOnce();
        });

        it('reads the page again, without the deleted sign-up', async () => {
            component.users.set([verified()]);
            await component.deleteUser(verified());
            expect(component.users().length).toBe(0);
        });

        it('takes one off the total and the confirmed count', async () => {
            component.totalUsers.set(5);
            component.verifiedUsers.set(3);
            await component.deleteUser(verified());
            expect(component.totalUsers()).toBe(4);
            expect(component.verifiedUsers()).toBe(2);
        });

        it('goes back a page when it deletes the last sign-up of the last page', async () => {
            component.pageSize.set(10);
            component.currentPage.set(1);
            component.totalUsers.set(11);
            await component.deleteUser(verified());
            expect(component.currentPage()).toBe(0);
        });
    });

    describe('deleteUser(), the retired registry', () => {
        it('no longer reads the global registry', async () => {
            const user = {
                id: 'user-1', email: 'a@b.com', isConfirmed: false,
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

        it('shows the page as it now is', async () => {
            const user = { id: 'user-1', email: 'a@b.com', isConfirmed: false } as any;
            component.users.set([user, { id: 'user-2', email: 'c@d.com' } as any]);
            component.waitlistId.set('waitlist-1');
            vi.mocked(FirestoreSDK.getDocs).mockResolvedValueOnce(snap([{ id: 'user-2', email: 'c@d.com' }]));

            await component.deleteUser(user);

            expect(component.users().map((u: any) => u.id)).toEqual(['user-2']);
        });
    });


    // -----------------------------------------------------------------------
    // deleteUser — error handling
    // -----------------------------------------------------------------------

    describe('deleteUser() — error handling', () => {
        it('shows a message, not the browser alert(), when batch.commit rejects', async () => {
            const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
            batchMock.commit.mockRejectedValue(new Error('Permission denied'));
            await component.deleteUser(
                makeUser({ emailVerified: false, isConfirmed: false, referredBy: undefined, waitlistedUserId: undefined })
            );
            expect(notify.error).toHaveBeenCalledWith('admin.forms.signup_delete_failed');
            expect(alertSpy).not.toHaveBeenCalled();
        });

        it('asks with the dialog, naming the person safely, never the browser confirm()', async () => {
            const nativeConfirm = vi.spyOn(window, 'confirm');
            confirmDialog.ask.mockClear();
            await component.deleteUser(makeUser({ firstName: '<img src=x>' }));
            expect(nativeConfirm).not.toHaveBeenCalled();
            const asked = (confirmDialog.ask.mock.calls[0] as any[])[0];
            expect(asked.panelType).toBe('warn');
            expect(asked.dialogMessage).toContain('&lt;img src=x&gt;');
            expect(asked.dialogMessage).not.toContain('<img');
        });

        it('should reset isDeleting to false after error', async () => {
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

        it('names every column and action with a translation key', () => {
            const headers = component.tableColumns.map((c) => c.header).filter((h) => h !== '#');
            expect(headers.every((h) => /^(admin|common)\./.test(h))).toBe(true);
            const labels = component.tableColumns.find((c) => c.key === 'actions')!.actions!.map((a: any) => a.label);
            expect(labels).toEqual(['admin.forms.signups.view', 'common.actions.delete']);
        });

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
