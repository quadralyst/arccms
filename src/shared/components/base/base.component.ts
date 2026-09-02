import { Location } from '@angular/common';
import { Component, inject, signal, ViewChild } from '@angular/core';
import { AbstractControl, FormControl, FormGroup } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, NavigationExtras, ParamMap, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ConstantVariables } from '../../constants';
import { QueryParams } from '../../models';
import { GlobalService } from '../../services/global.service';
import { ToastService } from '../../services/toast.service';
import { NotifyService } from '../../services/notify.service';
import { TranslocoService } from '@jsverse/transloco';
import { TranslationKey } from '../../../app/core/i18n/translation-keys';

export enum IActionType {
    Add = 'add',
    Edit = 'edit',
    View = 'view',
}

export enum UserStatus {
    Active = 'active',
    Pending = 'pending',
    Disable = 'disable',
}

export enum UserRole {
    Admin = 'admin',
    User = 'user',
    PropertyOwner = 'propertyOwner',
    FacilityManager = 'facilityManager',
}

/**
 * Base Component
 * 
 * Provides common functionality that can be extended by other components.
 * This is a simplified version without Firebase auth and ng-idle dependencies.
 * Those will be added when Firebase is integrated (Step 6+).
 */
@Component({
    selector: 'app-base',
    standalone: true,
    imports: [],
    template: '',
})
export class BaseComponent {
    location = inject(Location);
    globalService = inject(GlobalService);
    toastService = inject(ToastService);
    /** Translated toasts; prefer this over toastService for our own messages. */
    notify = inject(NotifyService);
    transloco = inject(TranslocoService);
    sanitizer = inject(DomSanitizer);

    isDebugMode = this.globalService.debugMode;
    searchValue: string | undefined;
    searchField: string | undefined;
    pathParams: { [key: string]: string } = {};
    activatedRoute = inject(ActivatedRoute);
    router = inject(Router);
    constantVariables = new ConstantVariables();

    currentSortColumn: string | null = '';
    currentSortOrder: 'asc' | 'desc' = 'asc';
    pageSize = this.constantVariables.PAGINATION_LIMIT;
    pageIndex = 0;
    previousPageIndex = -1;
    pageSizeOptions = [2, 3, 5, 10];

    currentId = signal('');
    currentEmpId = signal('');
    currentAction = signal('');
    showFilter = signal(false);

    clickableText: SafeHtml = '';
    batchSize = 10;
    paginationMessage: string = '';
    currentPage = signal<number>(1);
    hasMoreData: boolean = true;
    conditions: any = { whereConditions: [] };
    routeSubscription: Subscription | null = null;
    start: number = 0;
    end: number = 10;

    /**
     * Retrieves the form errors for a given form group.
     */
    /**
     * A translated string, with the key checked at compile time.
     *
     * Prefer this over `transloco.translate()` in TypeScript: the key is typed
     * as `TranslationKey`, so a typo fails the build instead of rendering
     * `ADMIN.FOO.BAR` to a user. Use `transloco.translate()` directly only for
     * a key computed at runtime, such as one built from a record's id.
     */
    t(key: TranslationKey, params?: Record<string, unknown>): string {
        return this.transloco.translate(key, params);
    }

    getFormErrors(formGroup: FormGroup): string[] {
        const errors: string[] = [];
        const controls = formGroup.controls;

        for (const name in controls) {
            if (controls[name].errors) {
                for (const errorName in controls[name].errors) {
                    // The frame is translated; the field name is the control's
                    // own key humanised, which is developer-authored and stays as
                    // it is. Translating it would mean naming every control in
                    // every language for a message most users never see.
                    const field = this.globalService.convertToNormalString(name);
                    const length = controls[name].errors?.[errorName]?.requiredLength;
                    switch (errorName) {
                        case 'required':
                            errors.push(this.transloco.translate('common.validation.required', { field }));
                            break;
                        case 'minlength':
                            errors.push(this.transloco.translate('common.validation.minlength', { field, length }));
                            break;
                        case 'maxlength':
                            errors.push(this.transloco.translate('common.validation.maxlength', { field, length }));
                            break;
                        default:
                            errors.push(this.transloco.translate('common.validation.generic', { field, error: errorName }));
                    }
                }
            }
        }
        return errors;
    }

    /**
     * Focus on the first invalid form field
     */
    focusFirstInvalidField(formGroup: FormGroup): void {
        const controls = formGroup.controls as { [key: string]: FormControl };
        for (const name in controls) {
            if (controls[name].invalid) {
                const element = document.querySelector(`[formControlName="${name}"]`);
                if (element) {
                    (element as HTMLElement).focus();
                }
                break;
            }
        }
    }

    /**
     * Clear error messages from form
     */
    clearErrorMessages(formGroup: FormGroup): void {
        Object.keys(formGroup.controls).forEach((key) => {
            const control = formGroup.get(key);
            if (control) {
                control.markAsPristine();
            }
        });
    }

    /**
     * Handle search clear
     */
    onClearSearch(event: any): void {
        if (event.target.value === '') {
            this.searchValue = '';
            this.searchField = '';
            this.onSearch(this.searchField, event.target.value);
        }
    }

    /**
     * Handle search
     */
    onSearch(searchField: string, searchValue: string): void {
        const params = { searchField: searchValue ? searchField : '', searchValue };
        this.navigate(params);
    }

    /**
     * Navigate with params
     */
    navigate(params: { [key: string]: string }): void {
        // Removing empty params
        Object.keys(params).map((paramNm) => {
            if (!params[paramNm]) {
                delete this.pathParams[paramNm];
                delete params[paramNm];
            }
        });

        const extras: NavigationExtras = { relativeTo: this.activatedRoute, replaceUrl: false };
        const pathParams: { [key: string]: string } = { ...this.pathParams, ...params };
        this.router.navigate([pathParams], extras);
    }

    /**
     * Get sort icon class
     */
    getSortIconClass(column: string): string {
        if (this.currentSortColumn !== column) {
            return '';
        }
        return this.currentSortOrder === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down';
    }

    /**
     * Handle sort
     */
    onSort(column: string): void {
        if (this.currentSortColumn === column) {
            this.currentSortOrder = this.currentSortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentSortOrder = 'asc';
        }

        this.currentSortColumn = column;

        if (this.currentSortColumn) {
            const params = {
                sortField: this.currentSortColumn,
                sortOrder: this.currentSortOrder,
            };
            this.navigate(params);
        }
    }

    /**
     * Check if value is array
     */
    isArray(value: any[]): boolean {
        return Array.isArray(value);
    }

    /**
     * Show/hide filter
     */
    showHideFilter(action: boolean): void {
        this.showFilter.set(action);
    }

    /**
     * Open add action
     */
    openAdd(): void {
        this.currentAction.set('add');
    }

    /**
     * Open edit action
     */
    openEdit(id: string): void {
        this.currentId.set(id);
        this.currentAction.set('edit');
    }

    /**
     * Open view action
     */
    openView(id: string): void {
        this.currentId.set(id);
        this.currentAction.set('view');
    }

    /**
     * Close drawer/action
     */
    closeDrawer(): void {
        this.currentId.set('');
        this.currentAction.set('');
    }

    /**
     * Restrict input to numeric only
     */
    restrictInputToNumeric(event: KeyboardEvent): void {
        const inputElement = event.target as HTMLInputElement;
        const allowedKeys = ['Delete', 'Backspace', 'Tab', 'Escape', 'Enter'];

        if (
            allowedKeys.includes(event.key) ||
            (event.key === 'a' && event.ctrlKey === true) ||
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight' ||
            event.key === 'Home' ||
            event.key === 'End'
        ) {
            return;
        }

        if (inputElement.value.length === 0 && event.key === '0') {
            event.preventDefault();
            return;
        }

        if ((event.shiftKey || event.key < '0' || event.key > '9') && (event.key < 'Numpad0' || event.key > 'Numpad9')) {
            event.preventDefault();
        }
    }

    /**
     * Trim unwanted spaces from form control
     */
    trimUnwantedSpace(control: AbstractControl): string {
        if (control && control.value) {
            const trimmedValue = control.value?.trim();
            control.setValue(trimmedValue);
            return trimmedValue;
        }
        return '';
    }

    /**
     * Merge date and time
     */
    mergeDateTime(date: any, time: string): Date {
        const originalDate = new Date(date);
        const [hours, minutes] = time.split(':').map(Number);

        const mergedDateTime = new Date(
            originalDate.getFullYear(),
            originalDate.getMonth(),
            originalDate.getDate(),
            hours,
            minutes,
        );

        return mergedDateTime;
    }

    /**
     * Format date to YYYY-MM-DD
     */
    formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Format time to HH:MM:SS
     */
    formatTime(date: Date): string {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }

    /**
     * Local search in data array
     */
    onLocalSearch(data: any[], searchValue: string, fields: string[]): any[] {
        searchValue = searchValue.toLowerCase().trim();
        if (!searchValue) {
            return data;
        }

        return data.filter((item) => {
            return fields.some((field) => {
                if (field.includes('.')) {
                    const keys = field.split('.');
                    let value = item;

                    for (let key of keys) {
                        if (Array.isArray(value)) {
                            return value.some((subItem) => {
                                let subValue = subItem;
                                for (let subKey of keys.slice(keys.indexOf(key))) {
                                    subValue = subValue?.[subKey];
                                    if (subValue === undefined) break;
                                }
                                return subValue && String(subValue).toLowerCase().includes(searchValue);
                            });
                        }
                        value = value?.[key];
                    }

                    return typeof value === 'string' && value.toLowerCase().includes(searchValue);
                }

                const value = item?.[field];
                return typeof value === 'string' && value.toLowerCase().includes(searchValue);
            });
        });
    }

    /**
     * Transform text with clickable links
     */
    updateClickableText(text: string): SafeHtml {
        if (text) {
            const urlRegex = /((https?:\/\/|www\.)[^\s]+)/g;

            let transformedText = text.replace(urlRegex, (url) => {
                const href = url.startsWith('http') ? url : `http://${url}`;
                return `<a href="${href}" target="_blank">${url}</a>`;
            });

            const bulletRegex = /^[*-]\s/gm;
            if (bulletRegex.test(transformedText)) {
                transformedText = transformedText.replace(
                    /(^|\n)([*-]\s[^\n]*)/g,
                    (_, start, item) => `${start}<ul><li>${item.slice(2)}</li></ul>`,
                );
                transformedText = transformedText.replace(/<\/ul>\s*<ul>/g, '');
            }

            transformedText = transformedText.replace(/\n/g, '<br>');

            this.clickableText = this.sanitizer.bypassSecurityTrustHtml(transformedText);
        }

        return this.clickableText;
    }

    /**
     * Update pagination message
     */
    updatePaginationMessage(total: number, limitCount?: number): void {
        const count = limitCount || this.batchSize;
        const currentPage = this.currentPage() ?? 1;
        const startRecord = (currentPage - 1) * count + 1;
        const endRecord = Math.min(currentPage * count, total);

        if (total === 0) {
            this.paginationMessage = 'No records found';
        } else {
            this.paginationMessage = `Showing ${startRecord} to ${endRecord} of ${total}`;
        }
    }

    /**
     * Update has more data flag
     */
    updateHasMoreData(total: number): void {
        this.hasMoreData = total > this.end;
    }

    subscribeToData(store: any, conditions?: any) {
        this.unsubscribeFromData(store);
        this.routeSubscription = this.activatedRoute.paramMap.subscribe((params: ParamMap) => {
            const queryParams: QueryParams = {
                limitCount: conditions?.limitCount ?? this.batchSize,
                currentPageNumber: this.pageIndex,
                previousPageNumber: this.previousPageIndex,
                whereConditions: conditions?.whereConditions || [],
                orConditions: conditions?.orConditions || [],
                orderByField: conditions?.orderByField?.field || 'createdAt',
                orderByDirection: conditions?.orderByField?.direction || 'desc',
                startAfterDoc: conditions?.startAfterDoc ?? {},
                endBeforeDoc: conditions?.endBeforeDoc ?? {},
            };

            this.pathParams = {};

            params.keys.map((paramNm) => (this.pathParams[paramNm] = params.get(paramNm) as string));

            if (params.get('role')) {
                this.searchValue = params.get('role') as string;
                queryParams.whereConditions = [{ field: 'role', operator: '==', value: this.searchValue }];
            }

            if (params.get('searchField') && params.get('searchValue')) {
                this.searchField = params.get('searchField') as string;
                this.searchValue = params.get('searchValue') as string;
                queryParams.whereConditions = [
                    { field: params.get('searchField') as string, operator: '==', value: params.get('searchValue') },
                ];
            }

            if (params.get('sortField') && params.get('sortOrder')) {
                this.currentSortColumn = params.get('sortField') as string;
                this.currentSortOrder = params.get('sortOrder') as 'asc' | 'desc';
                queryParams.orderByField = this.currentSortColumn;
                queryParams.orderByDirection = this.currentSortOrder;
            }

            if (params.get('pageSize')) {
                this.pageSize = Number(params.get('pageSize'));
                queryParams.limitCount = this.pageSize;
            }

            if (params.get('pageIndex')) {
                this.pageIndex = Number(params.get('pageIndex'));
                queryParams.currentPageNumber = this.pageIndex;
            }

            if (params.get('previousPageIndex')) {
                this.previousPageIndex = Number(params.get('previousPageIndex'));
                queryParams.previousPageNumber = this.previousPageIndex;
            }

            store.getAll(queryParams);
        });
    }

    unsubscribeFromData(store: any) {
        if (this.routeSubscription) {
            store.unsubscribeStore();
            this.routeSubscription.unsubscribe();
            this.routeSubscription = null;
        }
    }
}

