/**
 * View User Component
 * 
 * Component for displaying user details in read-only mode.
 */

import { RouteMeta } from '@analogjs/router';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, input, Output } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { UserStore } from '../user.store';
import { IUser } from '../user.model';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'View User | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'arc-view-user',
    standalone: true,
    imports: [ReactiveFormsModule],
    providers: [DatePipe],
    templateUrl: './view-user.html',
    styleUrl: './view-user.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class ViewUserComponent extends BaseComponent {
    @Output() close = new EventEmitter<void>();
    action = input('view');

    userStore = inject(UserStore);
    datePipe = inject(DatePipe);
    // private variable for id
    #id = '';
    @Input()
    get id(): string {
        return this.#id;
    }
    set id(newValue: string) {
        this.#id = newValue;
        if (this.id) {
            this.userStore.getById(this.id);
        }
    }

    // Get the current item from store
    get currentItem(): IUser | null {
        return this.userStore.currentItem() || null;
    }

    closeView(): void {
        this.close.emit();
    }

    formatDisplayDate(date: any): string {
        if (!date) return 'N/A';
        const newDate = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
        return this.datePipe.transform(newDate, 'EEE, MMM d, y, h:mm a') || 'N/A';
    }

    getStatusBadgeClass(): string {
        if (!this.currentItem) return 'bg-secondary';
        switch (this.currentItem.status?.toLowerCase()) {
            case 'active':
                return 'bg-success';
            case 'pending':
                return 'bg-warning text-dark';
            case 'disable':
            case 'disabled':
                return 'bg-danger';
            default:
                return 'bg-secondary';
        }
    }
}
