/**
 * View User Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

import ViewUserComponent from './view.[userId].page';
import { UserStore } from '../user.store';
import { ToastService } from '../../../../../shared/services/toast.service';
import { GlobalService } from '../../../../../shared/services/global.service';

describe('ViewUserComponent', () => {
    let component: ViewUserComponent;
    let fixture: ComponentFixture<ViewUserComponent>;

    const mockUser = {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        status: 'Active',
        role: 'user',
        isActive: true,
        emailVerified: true,
        createdAt: { seconds: Date.now() / 1000 },
        updatedAt: { seconds: Date.now() / 1000 },
    };

    const mockUserStore = {
        items: signal([mockUser]),
        currentItem: signal(mockUser),
        getById: vi.fn(),
    };

    const mockToastService = {
        success: vi.fn(),
        error: vi.fn(),
    };

    const mockGlobalService = {
        debugMode: false,
        showCurrentYear: () => 2025,
    };

    const mockRouter = {
        navigate: vi.fn(),
    };

    const mockActivatedRoute = {
        params: of({}),
        paramMap: of({ get: () => null }),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ViewUserComponent, BrowserAnimationsModule],
            providers: [
                { provide: UserStore, useValue: mockUserStore },
                { provide: ToastService, useValue: mockToastService },
                { provide: GlobalService, useValue: mockGlobalService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ViewUserComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Initialization', () => {
        it('should create the component', () => {
            expect(component).toBeTruthy();
        });

        it('should return currentItem from store', () => {
            expect(component.currentItem).toBe(mockUser);
        });
    });

    describe('ID Input', () => {
        it('should call getById when id is set', () => {
            component.id = 'user-1';
            expect(mockUserStore.getById).toHaveBeenCalledWith('user-1');
        });

        it('should not call getById for empty id', () => {
            mockUserStore.getById.mockClear();
            component.id = '';
            expect(mockUserStore.getById).not.toHaveBeenCalled();
        });
    });

    describe('Close Action', () => {
        it('should emit close event', () => {
            const closeSpy = vi.spyOn(component.close, 'emit');

            component.closeView();

            expect(closeSpy).toHaveBeenCalled();
        });
    });

    describe('Date Formatting', () => {
        it('should format Firebase timestamp', () => {
            const timestamp = { seconds: 1702500000 };
            const result = component.formatDisplayDate(timestamp);
            expect(result).toBeTruthy();
            expect(result).not.toBe('N/A');
        });

        it('should return N/A for null date', () => {
            expect(component.formatDisplayDate(null)).toBe('N/A');
        });

        it('should return N/A for undefined date', () => {
            expect(component.formatDisplayDate(undefined)).toBe('N/A');
        });

        it('should format regular Date object', () => {
            const date = new Date('2024-01-15');
            const result = component.formatDisplayDate(date);
            expect(result).toBeTruthy();
            expect(result).toContain('2024');
        });
    });

    describe('Status Badge Class', () => {
        it('should return success class for active status', () => {
            mockUserStore.currentItem = signal({ ...mockUser, status: 'Active' });
            expect(component.getStatusBadgeClass()).toBe('bg-success');
        });

        it('should return warning class for pending status', () => {
            mockUserStore.currentItem = signal({ ...mockUser, status: 'Pending' });
            expect(component.getStatusBadgeClass()).toBe('bg-warning text-dark');
        });

        it('should return danger class for disabled status', () => {
            mockUserStore.currentItem = signal({ ...mockUser, status: 'Disable' });
            expect(component.getStatusBadgeClass()).toBe('bg-danger');
        });

        it('should return secondary class for unknown status', () => {
            mockUserStore.currentItem = signal({ ...mockUser, status: 'Unknown' });
            expect(component.getStatusBadgeClass()).toBe('bg-secondary');
        });

        it('should return secondary class when no current item', () => {
            mockUserStore.currentItem = signal(null);
            expect(component.getStatusBadgeClass()).toBe('bg-secondary');
        });
    });
});
