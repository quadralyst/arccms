/**
 * Tests for BaseComponent
 * 
 * These tests verify the base component class that provides common
 * functionality to be extended by other components.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute, provideRouter } from '@angular/router';
import { Location } from '@angular/common';
import {
    BaseComponent,
    IActionType,
    UserStatus,
    UserRole
} from './base.component';
import { GlobalService } from '../../services/global.service';
import { ToastService } from '../../services/toast.service';

// Test component that extends BaseComponent
@Component({
    selector: 'test-base',
    standalone: true,
    imports: [ReactiveFormsModule],
    template: '<div></div>',
})
class TestBaseComponent extends BaseComponent { }

describe('BaseComponent', () => {
    let component: TestBaseComponent;
    let fixture: ComponentFixture<TestBaseComponent>;
    let router: Router;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TestBaseComponent],
            providers: [
                provideRouter([]),
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            params: {},
                            paramMap: {
                                get: (key: string) => null,
                            },
                        },
                    },
                },
                GlobalService,
                ToastService,
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(TestBaseComponent);
        component = fixture.componentInstance;
        router = TestBed.inject(Router);
        fixture.detectChanges();
    });

    describe('Enums', () => {
        describe('IActionType', () => {
            it('should have Add equal to "add"', () => {
                expect(IActionType.Add).toBe('add');
            });

            it('should have Edit equal to "edit"', () => {
                expect(IActionType.Edit).toBe('edit');
            });

            it('should have View equal to "view"', () => {
                expect(IActionType.View).toBe('view');
            });
        });

        describe('UserStatus', () => {
            it('should have Active equal to "active"', () => {
                expect(UserStatus.Active).toBe('active');
            });

            it('should have Pending equal to "pending"', () => {
                expect(UserStatus.Pending).toBe('pending');
            });

            it('should have Disable equal to "disable"', () => {
                expect(UserStatus.Disable).toBe('disable');
            });
        });

        describe('UserRole', () => {
            it('should have Admin equal to "admin"', () => {
                expect(UserRole.Admin).toBe('admin');
            });

            it('should have User equal to "user"', () => {
                expect(UserRole.User).toBe('user');
            });

            it('should have PropertyOwner equal to "propertyOwner"', () => {
                expect(UserRole.PropertyOwner).toBe('propertyOwner');
            });

            it('should have FacilityManager equal to "facilityManager"', () => {
                expect(UserRole.FacilityManager).toBe('facilityManager');
            });
        });
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should inject Location service', () => {
            expect(component.location).toBeTruthy();
        });

        it('should inject GlobalService', () => {
            expect(component.globalService).toBeTruthy();
        });

        it('should inject ToastService', () => {
            expect(component.toastService).toBeTruthy();
        });

        it('should inject DomSanitizer', () => {
            expect(component.sanitizer).toBeTruthy();
        });

        it('should inject ActivatedRoute', () => {
            expect(component.activatedRoute).toBeTruthy();
        });

        it('should inject Router', () => {
            expect(component.router).toBeTruthy();
        });

        it('should have ConstantVariables instance', () => {
            expect(component.constantVariables).toBeTruthy();
            expect(component.constantVariables.APPLICATION_NAME).toBe('Arc CMS');
        });
    });

    describe('Default Values', () => {
        it('should have correct pageSize from constants', () => {
            expect(component.pageSize).toBe(10);
        });

        it('should have pageIndex initialized to 0', () => {
            expect(component.pageIndex).toBe(0);
        });

        it('should have previousPageIndex initialized to -1', () => {
            expect(component.previousPageIndex).toBe(-1);
        });

        it('should have correct pageSizeOptions', () => {
            expect(component.pageSizeOptions).toEqual([2, 3, 5, 10]);
        });

        it('should have empty currentId signal', () => {
            expect(component.currentId()).toBe('');
        });

        it('should have empty currentAction signal', () => {
            expect(component.currentAction()).toBe('');
        });

        it('should have showFilter signal as false', () => {
            expect(component.showFilter()).toBe(false);
        });

        it('should have batchSize of 10', () => {
            expect(component.batchSize).toBe(10);
        });

        it('should have empty paginationMessage', () => {
            expect(component.paginationMessage).toBe('');
        });

        it('should have currentPage signal as 1', () => {
            expect(component.currentPage()).toBe(1);
        });

        it('should have hasMoreData as true', () => {
            expect(component.hasMoreData).toBe(true);
        });

        it('should have currentSortColumn as empty string', () => {
            expect(component.currentSortColumn).toBe('');
        });

        it('should have currentSortOrder as asc', () => {
            expect(component.currentSortOrder).toBe('asc');
        });
    });

    describe('getFormErrors', () => {
        it('should return empty array for valid form', () => {
            const form = new FormGroup({
                name: new FormControl('John'),
            });
            expect(component.getFormErrors(form)).toEqual([]);
        });

        it('should return required error message', () => {
            const form = new FormGroup({
                name: new FormControl('', Validators.required),
            });
            const errors = component.getFormErrors(form);
            expect(errors).toContain('Name is required.');
        });

        it('should return minlength error message', () => {
            const form = new FormGroup({
                name: new FormControl('ab', Validators.minLength(3)),
            });
            const errors = component.getFormErrors(form);
            expect(errors[0]).toContain('must be at least');
            expect(errors[0]).toContain('3');
        });

        it('should return maxlength error message', () => {
            const form = new FormGroup({
                name: new FormControl('abcdef', Validators.maxLength(5)),
            });
            const errors = component.getFormErrors(form);
            expect(errors[0]).toContain('cannot be more than');
            expect(errors[0]).toContain('5');
        });

        it('should return generic error for unknown validators', () => {
            const form = new FormGroup({
                email: new FormControl('invalid', Validators.email),
            });
            const errors = component.getFormErrors(form);
            expect(errors[0]).toContain('has an error');
        });

        it('should convert camelCase field names', () => {
            const form = new FormGroup({
                firstName: new FormControl('', Validators.required),
            });
            const errors = component.getFormErrors(form);
            expect(errors[0]).toContain('First name');
        });
    });

    describe('focusFirstInvalidField', () => {
        it('should focus on first invalid field', () => {
            // Create a mock DOM element
            const mockElement = document.createElement('input');
            mockElement.setAttribute('formControlName', 'name');
            const focusSpy = vi.spyOn(mockElement, 'focus');

            vi.spyOn(document, 'querySelector').mockReturnValue(mockElement);

            const form = new FormGroup({
                name: new FormControl('', Validators.required),
            });

            component.focusFirstInvalidField(form);

            expect(focusSpy).toHaveBeenCalled();
        });

        it('should not throw when no invalid fields', () => {
            const form = new FormGroup({
                name: new FormControl('John'),
            });
            expect(() => component.focusFirstInvalidField(form)).not.toThrow();
        });
    });

    describe('clearErrorMessages', () => {
        it('should mark all controls as pristine', () => {
            const form = new FormGroup({
                name: new FormControl('', Validators.required),
                email: new FormControl('', Validators.required),
            });

            form.get('name')?.markAsDirty();
            form.get('email')?.markAsDirty();

            component.clearErrorMessages(form);

            expect(form.get('name')?.pristine).toBe(true);
            expect(form.get('email')?.pristine).toBe(true);
        });
    });

    describe('onClearSearch', () => {
        it('should clear search values when input is empty', () => {
            component.searchValue = 'test';
            component.searchField = 'name';

            const mockEvent = { target: { value: '' } };
            vi.spyOn(component, 'onSearch').mockImplementation(() => { });

            component.onClearSearch(mockEvent);

            expect(component.searchValue).toBe('');
            expect(component.searchField).toBe('');
        });

        it('should not clear values when input has value', () => {
            component.searchValue = 'test';
            component.searchField = 'name';

            const mockEvent = { target: { value: 'new value' } };

            component.onClearSearch(mockEvent);

            expect(component.searchValue).toBe('test');
        });
    });

    describe('onSearch', () => {
        it('should call navigate with search params', () => {
            const navigateSpy = vi.spyOn(component, 'navigate').mockImplementation(() => { });

            component.onSearch('name', 'John');

            expect(navigateSpy).toHaveBeenCalledWith({
                searchField: 'name',
                searchValue: 'John',
            });
        });

        it('should clear searchField when searchValue is empty', () => {
            const navigateSpy = vi.spyOn(component, 'navigate').mockImplementation(() => { });

            component.onSearch('name', '');

            expect(navigateSpy).toHaveBeenCalledWith({
                searchField: '',
                searchValue: '',
            });
        });
    });

    describe('navigate', () => {
        it('should call router.navigate', () => {
            const routerSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

            component.navigate({ page: '1' });

            expect(routerSpy).toHaveBeenCalled();
        });

        it('should remove empty params', () => {
            const routerSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

            component.pathParams = { existing: 'value' };
            component.navigate({ new: 'param', empty: '' });

            expect(routerSpy).toHaveBeenCalled();
        });
    });

    describe('getSortIconClass', () => {
        it('should return empty string when column does not match', () => {
            component.currentSortColumn = 'name';
            expect(component.getSortIconClass('email')).toBe('');
        });

        it('should return arrow_drop_up for ascending', () => {
            component.currentSortColumn = 'name';
            component.currentSortOrder = 'asc';
            expect(component.getSortIconClass('name')).toBe('arrow_drop_up');
        });

        it('should return arrow_drop_down for descending', () => {
            component.currentSortColumn = 'name';
            component.currentSortOrder = 'desc';
            expect(component.getSortIconClass('name')).toBe('arrow_drop_down');
        });
    });

    describe('onSort', () => {
        it('should toggle sort order for same column', () => {
            const navigateSpy = vi.spyOn(component, 'navigate').mockImplementation(() => { });

            component.currentSortColumn = 'name';
            component.currentSortOrder = 'asc';

            component.onSort('name');

            expect(component.currentSortOrder).toBe('desc');
        });

        it('should set asc for new column', () => {
            const navigateSpy = vi.spyOn(component, 'navigate').mockImplementation(() => { });

            component.currentSortColumn = 'name';
            component.currentSortOrder = 'desc';

            component.onSort('email');

            expect(component.currentSortColumn).toBe('email');
            expect(component.currentSortOrder).toBe('asc');
        });

        it('should call navigate with sort params', () => {
            const navigateSpy = vi.spyOn(component, 'navigate').mockImplementation(() => { });

            component.onSort('name');

            expect(navigateSpy).toHaveBeenCalledWith({
                sortField: 'name',
                sortOrder: expect.any(String),
            });
        });
    });

    describe('isArray', () => {
        it('should return true for array', () => {
            expect(component.isArray([1, 2, 3])).toBe(true);
        });

        it('should return false for non-array', () => {
            expect(component.isArray('string' as any)).toBe(false);
            expect(component.isArray({} as any)).toBe(false);
            expect(component.isArray(123 as any)).toBe(false);
        });
    });

    describe('showHideFilter', () => {
        it('should set showFilter to true', () => {
            component.showHideFilter(true);
            expect(component.showFilter()).toBe(true);
        });

        it('should set showFilter to false', () => {
            component.showFilter.set(true);
            component.showHideFilter(false);
            expect(component.showFilter()).toBe(false);
        });
    });

    describe('Action Methods', () => {
        describe('openAdd', () => {
            it('should set currentAction to add', () => {
                component.openAdd();
                expect(component.currentAction()).toBe('add');
            });
        });

        describe('openEdit', () => {
            it('should set currentId and currentAction to edit', () => {
                component.openEdit('123');
                expect(component.currentId()).toBe('123');
                expect(component.currentAction()).toBe('edit');
            });
        });

        describe('openView', () => {
            it('should set currentId and currentAction to view', () => {
                component.openView('456');
                expect(component.currentId()).toBe('456');
                expect(component.currentAction()).toBe('view');
            });
        });

        describe('closeDrawer', () => {
            it('should clear currentId and currentAction', () => {
                component.currentId.set('123');
                component.currentAction.set('edit');

                component.closeDrawer();

                expect(component.currentId()).toBe('');
                expect(component.currentAction()).toBe('');
            });
        });
    });

    describe('restrictInputToNumeric', () => {
        const createKeyEventWithTarget = (key: string, value: string): KeyboardEvent => {
            const input = document.createElement('input');
            input.value = value;
            const event = new KeyboardEvent('keydown', { key, bubbles: true });
            Object.defineProperty(event, 'target', { value: input, writable: false });
            return event;
        };

        it('should allow numeric keys', () => {
            const event = createKeyEventWithTarget('5', '123');
            const preventSpy = vi.spyOn(event, 'preventDefault');

            component.restrictInputToNumeric(event);

            expect(preventSpy).not.toHaveBeenCalled();
        });

        it('should allow Backspace', () => {
            const event = createKeyEventWithTarget('Backspace', '123');
            const preventSpy = vi.spyOn(event, 'preventDefault');

            component.restrictInputToNumeric(event);

            expect(preventSpy).not.toHaveBeenCalled();
        });

        it('should allow Tab', () => {
            const event = createKeyEventWithTarget('Tab', '123');
            const preventSpy = vi.spyOn(event, 'preventDefault');

            component.restrictInputToNumeric(event);

            expect(preventSpy).not.toHaveBeenCalled();
        });

        it('should allow arrow keys', () => {
            const leftEvent = createKeyEventWithTarget('ArrowLeft', '123');
            const rightEvent = createKeyEventWithTarget('ArrowRight', '123');

            expect(() => component.restrictInputToNumeric(leftEvent)).not.toThrow();
            expect(() => component.restrictInputToNumeric(rightEvent)).not.toThrow();
        });

        it('should prevent letter keys', () => {
            const event = createKeyEventWithTarget('a', '123');
            const preventSpy = vi.spyOn(event, 'preventDefault');

            component.restrictInputToNumeric(event);

            expect(preventSpy).toHaveBeenCalled();
        });

        it('should prevent leading zero', () => {
            const event = createKeyEventWithTarget('0', '');
            const preventSpy = vi.spyOn(event, 'preventDefault');

            component.restrictInputToNumeric(event);

            expect(preventSpy).toHaveBeenCalled();
        });

        it('should allow zero after other digits', () => {
            const event = createKeyEventWithTarget('0', '12');
            const preventSpy = vi.spyOn(event, 'preventDefault');

            component.restrictInputToNumeric(event);

            expect(preventSpy).not.toHaveBeenCalled();
        });
    });

    describe('trimUnwantedSpace', () => {
        it('should trim whitespace from control value', () => {
            const control = new FormControl('  test  ');
            const result = component.trimUnwantedSpace(control);

            expect(result).toBe('test');
            expect(control.value).toBe('test');
        });

        it('should return empty string for null value', () => {
            const control = new FormControl(null);
            expect(component.trimUnwantedSpace(control)).toBe('');
        });

        it('should return empty string for undefined control', () => {
            expect(component.trimUnwantedSpace(null as any)).toBe('');
        });
    });

    describe('mergeDateTime', () => {
        it('should merge date and time', () => {
            const date = new Date('2023-12-11');
            const time = '14:30';

            const result = component.mergeDateTime(date, time);

            expect(result.getHours()).toBe(14);
            expect(result.getMinutes()).toBe(30);
            expect(result.getDate()).toBe(11);
        });
    });

    describe('formatDate', () => {
        it('should format date as YYYY-MM-DD', () => {
            const date = new Date('2023-12-11');
            expect(component.formatDate(date)).toBe('2023-12-11');
        });

        it('should pad single digit month and day', () => {
            const date = new Date('2023-01-05');
            expect(component.formatDate(date)).toBe('2023-01-05');
        });
    });

    describe('formatTime', () => {
        it('should format time as HH:MM:SS', () => {
            const date = new Date('2023-12-11T14:30:45');
            expect(component.formatTime(date)).toBe('14:30:45');
        });

        it('should pad single digit values', () => {
            const date = new Date('2023-12-11T09:05:03');
            expect(component.formatTime(date)).toBe('09:05:03');
        });
    });

    describe('onLocalSearch', () => {
        const testData = [
            { name: 'John Doe', email: 'john@example.com' },
            { name: 'Jane Smith', email: 'jane@example.com' },
            { name: 'Bob Wilson', email: 'bob@example.com' },
        ];

        it('should return all data for empty search', () => {
            const result = component.onLocalSearch(testData, '', ['name']);
            expect(result).toHaveLength(3);
        });

        it('should filter by single field', () => {
            const result = component.onLocalSearch(testData, 'john', ['name']);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('John Doe');
        });

        it('should search across multiple fields', () => {
            const result = component.onLocalSearch(testData, 'jane', ['name', 'email']);
            expect(result).toHaveLength(1);
        });

        it('should be case insensitive', () => {
            const result = component.onLocalSearch(testData, 'JOHN', ['name']);
            expect(result).toHaveLength(1);
        });

        it('should trim search value', () => {
            const result = component.onLocalSearch(testData, '  john  ', ['name']);
            expect(result).toHaveLength(1);
        });

        it('should handle nested fields', () => {
            const nestedData = [
                { user: { name: 'John' } },
                { user: { name: 'Jane' } },
            ];
            const result = component.onLocalSearch(nestedData, 'john', ['user.name']);
            expect(result).toHaveLength(1);
        });

        it('should handle array fields with nested search', () => {
            const arrayData = [
                { tags: [{ name: 'javascript' }, { name: 'typescript' }] },
                { tags: [{ name: 'python' }] },
            ];
            const result = component.onLocalSearch(arrayData, 'java', ['tags.name']);
            expect(result).toHaveLength(1);
        });
    });

    describe('updateClickableText', () => {
        it('should convert URLs to links', () => {
            const result = component.updateClickableText('Visit https://example.com');
            expect(result.toString()).toContain('href="https://example.com"');
        });

        it('should handle www URLs', () => {
            const result = component.updateClickableText('Visit www.example.com');
            expect(result.toString()).toContain('href="http://www.example.com"');
        });

        it('should convert bullet points to list', () => {
            const result = component.updateClickableText('* Item 1\n* Item 2');
            expect(result.toString()).toContain('<ul>');
            expect(result.toString()).toContain('<li>');
        });

        it('should convert newlines to br', () => {
            const result = component.updateClickableText('Line 1\nLine 2');
            expect(result.toString()).toContain('<br>');
        });

        it('should handle empty string', () => {
            const result = component.updateClickableText('');
            expect(result).toBe('');
        });
    });

    describe('updatePaginationMessage', () => {
        it('should show correct message for first page', () => {
            component.currentPage.set(1);
            component.updatePaginationMessage(100);

            expect(component.paginationMessage).toBe('Showing 1 to 10 of 100');
        });

        it('should show correct message for middle page', () => {
            component.currentPage.set(2);
            component.updatePaginationMessage(100);

            expect(component.paginationMessage).toBe('Showing 11 to 20 of 100');
        });

        it('should show correct message for last page', () => {
            component.currentPage.set(10);
            component.updatePaginationMessage(95);

            expect(component.paginationMessage).toBe('Showing 91 to 95 of 95');
        });

        it('should show no records message for zero total', () => {
            component.updatePaginationMessage(0);

            expect(component.paginationMessage).toBe('No records found');
        });

        it('should use custom limit count', () => {
            component.currentPage.set(1);
            component.updatePaginationMessage(50, 5);

            expect(component.paginationMessage).toBe('Showing 1 to 5 of 50');
        });
    });

    describe('updateHasMoreData', () => {
        it('should set hasMoreData to true when more data exists', () => {
            component.start = 0;
            component.end = 10;
            component.updateHasMoreData(100);

            expect(component.hasMoreData).toBe(true);
        });

        it('should set hasMoreData to false when no more data', () => {
            component.start = 0;
            component.end = 10;
            component.updateHasMoreData(10);

            expect(component.hasMoreData).toBe(false);
        });

        it('should set hasMoreData to false when total is less than end', () => {
            component.start = 0;
            component.end = 10;
            component.updateHasMoreData(5);

            expect(component.hasMoreData).toBe(false);
        });
    });
});
