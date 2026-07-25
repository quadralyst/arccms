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
import { EmailConfigStatusService } from '../../../../shared/services/email-config-status.service';

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

    beforeEach(async () => {
        mockRouter = { navigate: vi.fn() };
        mockFirestore = {};

        // Mock GlobalTableComponent
        @Component({
            selector: 'app-global-table',
            template: '',
            standalone: true,
            inputs: ['data', 'columns', 'loading', 'emptyTitle', 'emptyDescription', 'emptyActionLabel'],
            outputs: ['emptyActionClick']
        })
        class MockGlobalTableComponent {
            emptyActionClick = new EventEmitter<void>();
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
                { provide: EmailConfigStatusService, useValue: mockEmailConfigService }
            ],
            schemas: [NO_ERRORS_SCHEMA]
        })
            .overrideComponent(WaitlistsComponent, {
                set: {
                    imports: [CommonModule, MockGlobalTableComponent, MockWaitlistEditDrawerComponent]
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
        it('should have correct action order: Edit, Users, Tags, Templates, Leaderboard, Delete', () => {
            component.initTableColumns();
            const actionsColumn = component.tableColumns.find(c => c.type === 'actions');
            const actions = actionsColumn?.actions?.map((a: any) => a.action);
            expect(actions).toEqual(['edit', 'users', 'tags', 'templates', 'leaderboard', 'delete']);
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
                gamificationEnabled: true,
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
                gamificationEnabled: false,
                targetListIds: ['newsletter'],
            });

            const data = vi.mocked(FirestoreSDK.setDoc).mock.calls[0][1] as Record<string, unknown>;
            // Own list is always present and leads; manual picks follow.
            expect(data['targetListIds']).toEqual(['waitlist-beta', 'newsletter']);
            expect(data['gamificationEnabled']).toBe(false);
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
                gamificationEnabled: true,
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
                gamificationEnabled: true,
                targetListIds: []
            });

            const updateCall = vi.mocked(FirestoreSDK.updateDoc).mock.calls[0];
            const data = updateCall[1] as Record<string, unknown>;
            expect(data['defaultTagId']).toBe('tag-xyz');
        });
    });

    describe('Delete Operation', () => {
        it('should show confirmation and delete', async () => {
            const mockWaitlist = {
                id: '123',
                name: 'Test',
                slug: 'test',
                isActive: true,
                totalSignups: 0
            };

            await component.deleteWaitlist(mockWaitlist);

            expect(FirestoreSDK.deleteDoc).toHaveBeenCalled();
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
