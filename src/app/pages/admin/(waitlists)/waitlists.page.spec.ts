/**
 * Tests for WaitlistsComponent (Admin)
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import WaitlistsComponent from './waitlists.page';
import { Firestore } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as FirestoreSDK from '@angular/fire/firestore';
import { NO_ERRORS_SCHEMA, Component, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { EmailConfigStatusService } from '../../../../shared/services/email-config-status.service';
import { Functions } from '@angular/fire/functions';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { NotifyService } from '../../../../shared/services/notify.service';

const { deleteForm } = vi.hoisted(() => ({ deleteForm: vi.fn() }));
vi.mock('@angular/fire/functions', () => ({
    Functions: class { },
    httpsCallable: vi.fn((_f: unknown, name: string) => (data: unknown) => deleteForm(name, data)),
}));

// Mock Firestore SDK functions
vi.mock('@angular/fire/firestore', () => {
    return {
        Firestore: class { },
        collection: vi.fn(),
        query: vi.fn(),
        orderBy: vi.fn(),
        onSnapshot: vi.fn(),
        doc: vi.fn(),
        addDoc: vi.fn(),
        setDoc: vi.fn(),
        updateDoc: vi.fn(),
        deleteDoc: vi.fn(),
        getCountFromServer: vi.fn(),
        getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
        getDocs: vi.fn().mockResolvedValue({ docs: [] }),
    };
});

// Mock Angular Material Dialog
vi.mock('@angular/material/dialog', () => {
    return {
        MatDialog: class {
            open = vi.fn().mockReturnValue({
                afterClosed: () => ({ subscribe: (fn: any) => fn(true) })
            });
        },
        MatDialogModule: class { },
        MAT_DIALOG_DATA: {},
        MatDialogRef: class { },
        MatDialogActions: class { },
        MatDialogClose: class { },
        MatDialogContent: class { },
        MatDialogTitle: class { }
    };
});

// Mock other Material modules
vi.mock('@angular/material/icon', () => ({ MatIconModule: class { } }));
vi.mock('@angular/material/button', () => ({ MatButtonModule: class { } }));

describe('WaitlistsComponent', () => {
    let component: WaitlistsComponent;
    let fixture: ComponentFixture<WaitlistsComponent>;
    let mockRouter: any;
    let mockFirestore: any;
    const mockEmailConfigService = {
        isEmailConfigured: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        bannerDismissed: vi.fn().mockReturnValue(false),
        shouldShowBanner: vi.fn().mockReturnValue(true),
        dismissBanner: vi.fn()
    };

    const confirmDialog = { ask: vi.fn(async () => true) };
    const notify = { error: vi.fn(), success: vi.fn() };

    beforeEach(async () => {
        confirmDialog.ask.mockClear();
        notify.error.mockClear();
        notify.success.mockClear();
        deleteForm.mockReset().mockResolvedValue({ data: { deleted: true, signups: 3, tags: 1 } });
        mockRouter = { navigate: vi.fn() };
        mockFirestore = {};

        // Mock GlobalTableComponent
        @Component({
            selector: 'app-global-table',
            template: '',
            standalone: true,
            inputs: ['data', 'columns', 'loading', 'error', 'emptyTitle', 'emptyDescription', 'emptyActionLabel'],
            outputs: ['emptyActionClick', 'retry']
        })
        class MockGlobalTableComponent {
            emptyActionClick = new EventEmitter<void>();
            retry = new EventEmitter<void>();
            error: unknown = null;
        }

        // Mock WaitlistEditDrawerComponent
        @Component({
            selector: 'arc-waitlist-edit-drawer',
            template: '',
            standalone: true,
            inputs: ['isOpen', 'action', 'waitlist'],
            outputs: ['saved', 'closed']
        })
        class MockWaitlistEditDrawerComponent {
            saved = new EventEmitter<any>();
            closed = new EventEmitter<void>();
        }

        await TestBed.configureTestingModule({
            imports: [WaitlistsComponent, BrowserAnimationsModule],
            providers: [
                { provide: Firestore, useValue: mockFirestore },
                { provide: Router, useValue: mockRouter },
                { provide: MatDialog, useClass: MatDialog },
                { provide: EmailConfigStatusService, useValue: mockEmailConfigService },
                { provide: Functions, useValue: {} },
                { provide: ConfirmService, useValue: confirmDialog },
                { provide: NotifyService, useValue: notify },
            ],
            schemas: [NO_ERRORS_SCHEMA]
        })
            .overrideComponent(WaitlistsComponent, {
                set: {
                    imports: [CommonModule, TranslocoPipe, MockGlobalTableComponent, MockWaitlistEditDrawerComponent]
                }
            })
            .compileComponents();

        fixture = TestBed.createComponent(WaitlistsComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Table Configuration', () => {
        it('should have correct action order: Edit, Users, Tags, Templates, Delete (no leaderboard)', () => {
            component.initTableColumns();
            const actionsColumn = component.tableColumns.find(c => c.type === 'actions');
            const actions = actionsColumn?.actions?.map((a: any) => a.action);
            expect(actions).toEqual(['edit', 'users', 'tags', 'templates', 'delete']);
        });
    });

    describe('Drawer State Management', () => {
        it('should open add drawer with correct action', () => {
            component.openAddDrawer();
            expect(component.isDrawerOpen()).toBe(true);
            expect(component.currentAction()).toBe('add');
            expect(component.currentWaitlist()).toBeNull();
        });

        it('should open edit drawer with correct waitlist data', () => {
            const mockWaitlist = {
                id: '123',
                name: 'Test',
                slug: 'test-slug',
                isActive: true,
                totalSignups: 0,
                defaultTagId: 'tag-1'
            };

            component.editWaitlist(mockWaitlist);

            expect(component.isDrawerOpen()).toBe(true);
            expect(component.currentAction()).toBe('edit');
            expect(component.currentId()).toBe('123');
            expect(component.currentWaitlist()).toEqual(mockWaitlist);
        });

        it('should close drawer and clear state', () => {
            component.isDrawerOpen.set(true);
            component.currentWaitlist.set({ id: '1', name: 'Test', slug: 'test', isActive: true, totalSignups: 0 });

            component.closeDrawer();

            expect(component.isDrawerOpen()).toBe(false);
            expect(component.currentWaitlist()).toBeNull();
        });
    });

    describe('Save Operations', () => {
        it('should add new waitlist via Firestore using setDoc', async () => {
            component.currentAction.set('add');

            await component.onDrawerSaved({
                name: 'Test',
                slug: 'test',
                description: 'Desc',
                coverImage: '',
                isActive: true,
                disabledMessage: '',
                defaultTagId: '',
                targetListIds: []
            });

            expect(FirestoreSDK.setDoc).toHaveBeenCalled();
            expect(component.isDrawerOpen()).toBe(false);
        });

        it('stamps the own system list into targetListIds on save (U3)', async () => {
            vi.mocked(FirestoreSDK.setDoc).mockClear();
            component.currentAction.set('add');

            await component.onDrawerSaved({
                name: 'Beta', slug: 'beta', description: '', coverImage: '',
                isActive: true, disabledMessage: '', defaultTagId: '',
                targetListIds: ['newsletter'],
            });

            const data = vi.mocked(FirestoreSDK.setDoc).mock.calls[0][1] as Record<string, unknown>;
            // Own list is always present and leads; manual picks follow.
            expect(data['targetListIds']).toEqual(['waitlist-beta', 'newsletter']);
            // Signup forms are plain: no switch is saved (specs/form-gamification-spec.md).
            expect(data).not.toHaveProperty('gamificationEnabled');
        });

        it('should update existing waitlist via updateDoc', async () => {
            vi.mocked(FirestoreSDK.updateDoc).mockClear();
            component.currentAction.set('edit');
            component.currentId.set('123');

            await component.onDrawerSaved({
                name: 'Test Update',
                slug: 'test-update',
                description: 'Desc',
                coverImage: '',
                isActive: true,
                disabledMessage: '',
                defaultTagId: '',
                targetListIds: []
            });

            expect(FirestoreSDK.doc).toHaveBeenCalledWith(mockFirestore, 'Waitlists', '123');
            expect(FirestoreSDK.updateDoc).toHaveBeenCalled();
        });

        it('should save defaultTagId when updating a waitlist', async () => {
            vi.mocked(FirestoreSDK.updateDoc).mockClear();
            component.currentAction.set('edit');
            component.currentId.set('wl-1');

            await component.onDrawerSaved({
                name: 'Test',
                slug: 'test',
                description: '',
                coverImage: '',
                isActive: true,
                disabledMessage: '',
                defaultTagId: 'tag-xyz',
                targetListIds: []
            });

            const updateCall = vi.mocked(FirestoreSDK.updateDoc).mock.calls[0];
            const data = updateCall[1] as Record<string, unknown>;
            expect(data['defaultTagId']).toBe('tag-xyz');
        });
    });

    describe('Address already in use', () => {
        it('refuses a new form whose address another form has, and writes nothing', async () => {
            vi.mocked(FirestoreSDK.setDoc).mockClear();
            vi.mocked(FirestoreSDK.getDoc).mockResolvedValueOnce({ exists: () => true } as any);
            component.currentAction.set('add');
            component.isDrawerOpen.set(true);
            await component.onDrawerSaved({
                name: 'Beta', slug: 'beta', description: '', coverImage: '',
                isActive: true, disabledMessage: '', defaultTagId: '', targetListIds: [], fieldMap: {},
            });
            expect(FirestoreSDK.setDoc).not.toHaveBeenCalled();
            expect(notify.error).toHaveBeenCalledWith('admin.forms.address_taken');
            expect(component.isDrawerOpen()).toBe(true);
        });

        it('shows a plain message when a save fails', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            vi.mocked(FirestoreSDK.updateDoc).mockRejectedValueOnce(new Error('permission-denied'));
            component.currentAction.set('edit');
            component.currentId.set('x');
            await component.onDrawerSaved({
                name: 'Beta', slug: 'beta', description: '', coverImage: '',
                isActive: true, disabledMessage: '', defaultTagId: '', targetListIds: [], fieldMap: {},
            });
            expect(notify.error).toHaveBeenCalledWith('admin.forms.save_failed');
        });
    });

    describe('Sign-up counts (RF5, 5.10)', () => {
        type Snap = { docs: { id: string; data: () => any }[] };
        const forms = (...f: [string, number][]): Snap => ({
            docs: f.map(([id, totalSignups]) => ({ id, data: () => ({ name: id, slug: id, isActive: true, totalSignups }) })),
        });
        let next: (s: Snap) => Promise<void>;
        let fail: (e: unknown) => void;

        beforeEach(() => {
            vi.mocked(FirestoreSDK.getCountFromServer).mockReset().mockResolvedValue({ data: () => ({ count: 7 }) } as any);
            vi.mocked(FirestoreSDK.onSnapshot).mockReset().mockImplementation(((_q: unknown, ok: any, bad: any) => {
                next = ok; fail = bad;
                return () => undefined;
            }) as any);
            component.loadWaitlists();
        });

        it('counts each form once, not again on every snapshot', async () => {
            await next(forms(['a', 1], ['b', 2]));
            expect(FirestoreSDK.getCountFromServer).toHaveBeenCalledTimes(2);
            expect(component.waitlists().map((w) => w.allUsersCount)).toEqual([7, 7]);

            // A snapshot where nothing about the sign-ups changed (a rename, say).
            await next(forms(['a', 1], ['b', 2]));
            expect(FirestoreSDK.getCountFromServer).toHaveBeenCalledTimes(2);
        });

        it('counts a form again only when its confirmed count moves, and counts a new form', async () => {
            await next(forms(['a', 1], ['b', 2]));
            vi.mocked(FirestoreSDK.getCountFromServer).mockResolvedValue({ data: () => ({ count: 9 }) } as any);
            await next(forms(['a', 2], ['b', 2], ['c', 0]));
            expect(FirestoreSDK.getCountFromServer).toHaveBeenCalledTimes(4);
            expect(component.waitlists().map((w) => w.allUsersCount)).toEqual([9, 7, 9]);
        });

        it('a fresh load (Retry) counts every form again, so unconfirmed sign-ups show up', async () => {
            await next(forms(['a', 1]));
            expect(FirestoreSDK.getCountFromServer).toHaveBeenCalledTimes(1);
            component.loadWaitlists();
            await next(forms(['a', 1]));
            expect(FirestoreSDK.getCountFromServer).toHaveBeenCalledTimes(2);
        });

        it('shows the load error with Retry, keeping the detail in the console', () => {
            const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            fail(new Error('permission-denied'));
            expect(component.loadError()).toBe(true);
            expect(component.loading()).toBe(false);
            expect(log).toHaveBeenCalled();

            fixture.detectChanges();
            const table = fixture.debugElement.query((el) => el.name === 'app-global-table').componentInstance;
            expect(table.error).toBe(true);
            table.retry.emit();
            expect(FirestoreSDK.onSnapshot).toHaveBeenCalledTimes(2);
            expect(component.loadError()).toBeNull();
        });
    });

    describe('Words (RF5, 5.3 and 5.4)', () => {
        it('names every column and action with a translation key, and says Address, not Slug', () => {
            component.initTableColumns();
            const headers = component.tableColumns.map((c) => c.header);
            expect(headers.every((h) => /^(admin|common)\./.test(h))).toBe(true);
            expect(headers).toContain('admin.forms.col.address');
            const labels = component.tableColumns.find((c) => c.type === 'actions')!.actions!.map((a: any) => a.label);
            expect(labels.every((l: string) => /^(admin|common)\./.test(l))).toBe(true);
        });

        it('says Forms on the page, not Waitlists', () => {
            fixture.detectChanges();
            const text = (fixture.nativeElement as HTMLElement).textContent || '';
            expect(text).toContain('Add form');
            expect(text).not.toMatch(/waitlist/i);
        });
    });

    describe('Delete Operation (RF4, 4.11 and 4.12)', () => {
        const form = { id: '123', name: 'Spring <b>sale</b>', slug: 'test', isActive: true, totalSignups: 2, allUsersCount: 3 };

        it('deletes the form, its sign-ups and its tags on the server, never from the browser', async () => {
            await component.deleteWaitlist(form);
            expect(deleteForm).toHaveBeenCalledWith('arccms-adminDeleteForm', { formId: '123' });
            expect(FirestoreSDK.deleteDoc).not.toHaveBeenCalled();
            expect(notify.success).toHaveBeenCalledWith('admin.forms.deleted');
        });

        it('says how many sign-ups go with it, naming the form safely', async () => {
            await component.deleteWaitlist(form);
            const asked = (confirmDialog.ask.mock.calls[0] as any[])[0];
            expect(asked.panelType).toBe('warn');
            expect(asked.dialogMessage).toContain('Spring &lt;b&gt;sale&lt;/b&gt;');
            expect(asked.dialogMessage).toContain('3 sign-ups and its tags');
        });

        it('deletes nothing when cancelled', async () => {
            confirmDialog.ask.mockResolvedValueOnce(false);
            await component.deleteWaitlist(form);
            expect(deleteForm).not.toHaveBeenCalled();
        });

        it('shows a message when the delete fails', async () => {
            deleteForm.mockRejectedValueOnce(new Error('internal'));
            await component.deleteWaitlist(form);
            expect(notify.error).toHaveBeenCalledWith('admin.forms.delete_failed');
        });
    });

    describe('Email Configuration Service', () => {
        it('should have emailConfigService injected', () => {
            expect(component.emailConfigService).toBeTruthy();
        });

        it('should expose shouldShowBanner method via service', () => {
            expect(component.emailConfigService.shouldShowBanner).toBeDefined();
        });
    });
});
