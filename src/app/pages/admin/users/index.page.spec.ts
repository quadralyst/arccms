/**
 * Users Page Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslocoPipe } from '@jsverse/transloco';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { BrowserAnimationsModule, NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import UsersComponent from './index.page';
import { UserStore } from './user.store';
import { ToastService } from '../../../../shared/services/toast.service';
import { ConstantVariables } from '../../../../shared/constants';
import { AuthService } from '../../(auth)/auth.service';
import { AuthState } from '../../(auth)/auth.store';

describe('UsersComponent', () => {
    let component: UsersComponent;
    let fixture: ComponentFixture<UsersComponent>;

    const mockUserStore = {
        items: signal([
            {
                id: 'user-1',
                name: 'Test User',
                email: 'test@example.com',
                status: 'Active',
                role: 'user',
                isActive: true,
                emailVerified: true,
                createdAt: { seconds: Date.now() / 1000 },
            },
        ]),
        isLoading: signal(false),
        totalRecords: signal(1),
        getAll: vi.fn(),
        delete: vi.fn().mockReturnValue(of({})),
        update: vi.fn().mockReturnValue(of({})),
        currentItem: signal(null),
        getById: vi.fn(),
    };

    const mockToastService = {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    };

    const mockDialog = {
        open: vi.fn().mockReturnValue({
            afterClosed: () => of(true),
        }),
    };

    const mockRouter = {
        navigate: vi.fn(),
    };

    const mockActivatedRoute = {
        params: of({}),
        snapshot: {
            queryParams: {},
        },
        queryParams: of({}),
    };

    const mockAuthService = {
        addEmailLookup: vi.fn().mockResolvedValue(undefined),
        removeEmailLookup: vi.fn().mockResolvedValue(undefined),
        isFirstRun: vi.fn().mockReturnValue(of(false)),
    };

    const mockAuthStore = {
        isAuthenticated: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        error: vi.fn().mockReturnValue(''),
        isSuccess: vi.fn().mockReturnValue(false),
        currentUser: vi.fn().mockReturnValue(null),
        initAuthStateListener: vi.fn().mockReturnValue(of(null)),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [NoopAnimationsModule],
            schemas: [NO_ERRORS_SCHEMA], // Ignore unknown elements/attributes
        })
            .overrideComponent(UsersComponent, {
                set: {
                    // Everything but the transloco pipe, which the template
                    // needs and which NO_ERRORS_SCHEMA cannot stand in for —
                    // an unknown *pipe* is an error, not an unknown element.
                    imports: [TranslocoPipe],
                    schemas: [NO_ERRORS_SCHEMA],
                }
            })
            .overrideProvider(UserStore, { useValue: mockUserStore })
            .overrideProvider(AuthService, { useValue: mockAuthService })
            .overrideProvider(AuthState, { useValue: mockAuthStore })
            .overrideProvider(ToastService, { useValue: mockToastService })
            .overrideProvider(Router, { useValue: mockRouter })
            .overrideProvider(ActivatedRoute, { useValue: mockActivatedRoute })
            .overrideProvider(MatDialog, { useValue: mockDialog })
            .compileComponents();

        fixture = TestBed.createComponent(UsersComponent);
        component = fixture.componentInstance;
    });

    describe('Initialization', () => {
        it('should create the component', () => {
            expect(component).toBeTruthy();
        });

        it('should initialize with default pagination values', () => {
            expect(component.currentPage()).toBe(0);
            expect(component.pageSize()).toBe(10);
        });

        it('should initialize with default sort values', () => {
            expect(component.sortField()).toBe('createdAt');
            expect(component.sortOrder()).toBe('desc');
        });

        it('should initialize with empty filters', () => {
            expect(component.filters()).toEqual({});
        });
    });

    describe('Drawer Actions', () => {
        beforeEach(() => {
            // Mock the drawer
            component.drawer = {
                open: vi.fn(),
                close: vi.fn(),
            } as any;
        });

        it('should open add drawer', () => {
            component.openAdd();
            expect(component.currentAction()).toBe('add');
            expect(component.currentId()).toBe('');
        });

        it('should open edit drawer with user id', () => {
            component.openEdit('user-123');
            expect(component.currentAction()).toBe('edit');
            expect(component.currentId()).toBe('user-123');
        });

        it('should open view drawer with user id', () => {
            component.openView('user-456');
            expect(component.currentAction()).toBe('view');
            expect(component.currentId()).toBe('user-456');
        });

        it('should close drawer and reset state', () => {
            component.currentAction.set('edit');
            component.currentId.set('user-123');

            component.closeDrawer();

            expect(component.currentAction()).toBe('');
            expect(component.currentId()).toBe('');
        });
    });

    describe('Pagination', () => {
        it('should handle page change events', () => {
            const pageEvent = { pageIndex: 2, pageSize: 25, length: 100 };
            component.onPageChange(pageEvent as any);

            expect(component.currentPage()).toBe(2);
            expect(component.pageSize()).toBe(25);
            expect(mockRouter.navigate).toHaveBeenCalled();
        });

        it('should calculate correct start record', () => {
            component.currentPage.set(0);
            component.pageSize.set(10);
            expect(component.getStartRecord()).toBe(1);
        });

        it('should calculate correct end record', () => {
            component.currentPage.set(0);
            component.pageSize.set(10);
            expect(component.getEndRecord()).toBe(1); // Only 1 user in mock
        });
    });

    describe('Sorting', () => {
        it('should toggle sort order when clicking same column', () => {
            component.sortField.set('name');
            component.sortOrder.set('asc');

            component.onSort('name');

            expect(component.sortOrder()).toBe('desc');
        });

        it('should set new sort field and default to asc', () => {
            component.sortField.set('name');

            component.onSort('email');

            expect(component.sortField()).toBe('email');
            expect(component.sortOrder()).toBe('asc');
        });

        it('should return correct sort icon class', () => {
            component.sortField.set('name');
            component.sortOrder.set('asc');

            expect(component.getSortIconClass('name')).toBe('arrow_drop_up');
            expect(component.getSortIconClass('email')).toBe('');
        });
    });

    describe('Filtering', () => {
        it('should update filters on filter change', () => {
            const event = { target: { value: 'test' } } as any;
            component.onFilterChange('name', event);

            expect(component.filters()['name']).toBe('test');
        });

        it('should clear filters', () => {
            component.filters.set({ name: 'test', email: 'test@example.com' });

            component.clearFilters();

            expect(component.filters()).toEqual({});
        });

        it('should detect active filters', () => {
            expect(component.hasActiveFilters()).toBe(false);

            component.filters.set({ name: 'test' });
            expect(component.hasActiveFilters()).toBe(true);
        });
    });

    describe('Date Formatting', () => {
        it('should format date from Firebase timestamp', () => {
            const timestamp = { seconds: 1702500000 };
            const result = component.formatNewDate(timestamp);
            expect(result).toBeTruthy();
            expect(result).not.toBe('N/A');
        });

        it('should return N/A for null date', () => {
            expect(component.formatNewDate(null)).toBe('N/A');
        });

        it('should return N/A for undefined date', () => {
            expect(component.formatNewDate(undefined)).toBe('N/A');
        });
    });

    describe('User Actions', () => {
        it('should have delete method', () => {
            expect(typeof component.deleteItem).toBe('function');
        });

        it('should have onActiveDeactivate method', () => {
            expect(typeof component.onActiveDeactivate).toBe('function');
        });
    });

    describe('deleteItem', () => {
        const sampleUser = {
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com',
        } as any;

        beforeEach(() => {
            mockToastService.success.mockClear();
            mockToastService.error.mockClear();
            mockUserStore.delete.mockReset();
            mockDialog.open.mockReturnValue({ afterClosed: () => of(true) } as any);
        });

        it('shows success toast when delete succeeds', async () => {
            mockUserStore.delete.mockReturnValue(of(undefined));

            component.deleteItem(sampleUser);
            await Promise.resolve();

            expect(mockUserStore.delete).toHaveBeenCalledWith('user-1');
            expect(mockToastService.success).toHaveBeenCalledWith('User deleted successfully.');
            expect(mockToastService.error).not.toHaveBeenCalled();
        });

        it('shows error toast and NOT success when delete errors (e.g. permission denied)', async () => {
            mockUserStore.delete.mockReturnValue(
                throwError(() => new Error('Missing or insufficient permissions.'))
            );

            component.deleteItem(sampleUser);
            await Promise.resolve();

            expect(mockUserStore.delete).toHaveBeenCalledWith('user-1');
            expect(mockToastService.error).toHaveBeenCalledWith('Failed to delete user.');
            expect(mockToastService.success).not.toHaveBeenCalled();
        });
    });
});
