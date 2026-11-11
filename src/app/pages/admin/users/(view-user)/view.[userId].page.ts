/**
 * View User Component
 * 
 * Component for displaying user details in read-only mode.
 */

import { RouteMeta } from '@analogjs/router';
import { SiteBrandService } from '../../../../core/brand/site-brand';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, input, Output } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { ArcTime } from '../../../../core/time/arc-time.service';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { UserStore } from '../user.store';
import { IUser, roleLabel } from '../user.model';
import type { TranslationKey } from '../../../../core/i18n/translation-keys';
import { roleGuard } from '../../../../guards/role.guard';

/** The statuses a user record can have (UserStatus, and Detached), by their stored value in lower case. */
const VIEW_STATUSES: Record<string, TranslationKey> = {
    active: 'admin.users.status_active',
    pending: 'admin.users.status_pending',
    disable: 'admin.users.status_blocked',
    disabled: 'admin.users.status_blocked',
    detached: 'admin.users.status_detached',
};

export const routeMeta: RouteMeta = {
    title: 'User details',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'arc-view-user',
    standalone: true,
    imports: [ReactiveFormsModule, TranslocoPipe],
    templateUrl: './view-user.html',
    styleUrl: './view-user.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class ViewUserComponent extends BaseComponent {
    /** The site's name for the footer (core/brand/site-brand.ts). */
    readonly siteName = inject(SiteBrandService).name;
    @Output() close = new EventEmitter<void>();
    action = input('view');

    userStore = inject(UserStore);
    private arcTime = inject(ArcTime);
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

    readonly roleName = (role: string) => roleLabel(role, (key) => this.t(key));

    /** The record's status in the admin's language; one the page does not know shows as stored. */
    statusText(): string {
        const status = String(this.currentItem?.status ?? '').toLowerCase();
        const key = VIEW_STATUSES[status];
        return key ? this.t(key) : (this.currentItem?.status || this.t('admin.users.view.none'));
    }

    closeView(): void {
        this.close.emit();
    }

    formatDisplayDate(date: any): string {
        const none = this.t('admin.users.view.none');
        if (!date) return none;
        const newDate = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
        return this.arcTime.format(newDate, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || none;
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
