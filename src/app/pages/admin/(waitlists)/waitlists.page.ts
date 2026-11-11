/**
 * Forms admin page (stored as `Waitlists`: the route and collection keep the old name).
 *
 * Lists the site's sign-up forms with their sign-up counts.
 */

import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, Injector, inject, runInInjectionContext, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Firestore, collection, onSnapshot, updateDoc, doc, getDoc, query, orderBy, setDoc, getCountFromServer } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { NotifyService } from '../../../../shared/services/notify.service';
import { arcCallable } from '../../../core/config/arc-functions';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { EmailConfigStatusService } from '../../../../shared/services/email-config-status.service';
import { roleGuard } from '../../../guards/role.guard';
import { WaitlistEditDrawerComponent, WaitlistFormData } from './edit-drawer/waitlist-edit-drawer.component';
import { escapeHtml } from '../../../../shared/utils/escape-html';

export const routeMeta: RouteMeta = {
    title: 'Forms',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

interface IWaitlist {
    id: string;
    name: string;
    slug: string;
    description?: string;
    coverImage?: string;
    isActive: boolean;
    disabledMessage?: string;
    totalSignups: number;
    allUsersCount?: number;
    defaultTagId?: string;
    targetListIds?: string[];
    /** Parsed form input names + their mapping to contact fields (U4.5). */
    fields?: string[];
    fieldMap?: Record<string, string>;
}

@Component({
    selector: 'arc-waitlists',
    templateUrl: './waitlists.page.html',
    styleUrls: ['./waitlists.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        MatDialogModule,
        MatIconModule,
        GlobalTableComponent,
        RouterLink,
        WaitlistEditDrawerComponent,
        PageHeaderComponent,
        TranslocoPipe
    ],
})
export default class WaitlistsComponent implements OnInit, OnDestroy {
    private router = inject(Router);
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private confirmDialog = inject(ConfirmService);
    private notify = inject(NotifyService);
    private transloco = inject(TranslocoService);
    private injector = inject(Injector);

    // Email configuration status
    emailConfigService = inject(EmailConfigStatusService);

    // State signals
    waitlists = signal<IWaitlist[]>([]);
    loading = signal(true);
    /** Set when the list of forms did not load; the table shows it with Retry. */
    loadError = signal<boolean | null>(null);
    isDrawerOpen = signal(false);
    currentAction = signal<'add' | 'edit'>('add');
    currentId = signal('');
    currentWaitlist = signal<IWaitlist | null>(null);

    private unsubscribe: (() => void) | null = null;

    /**
     * Sign-up counts already read, by form id, with the confirmed count they were
     * read at. A form is counted once per load, and again only when its
     * confirmed count moves (a new or deleted sign-up), not on every snapshot.
     */
    private counted = new Map<string, { at: number; count: number }>();
    /** The latest snapshot: one whose counts arrive after a newer one is dropped. */
    private snapTicket = 0;

    // Table Columns Configuration
    tableColumns: TableColumn[] = [];

    ngOnInit(): void {
        this.loadWaitlists();
        this.initTableColumns();
    }

    initTableColumns() {
        this.tableColumns = [
            {
                key: 'name',
                header: 'admin.forms.col.name',
                classFn: () => 'fw-bold'
            },
            {
                key: 'slug',
                header: 'admin.forms.col.address',
                type: 'code',
                transformFn: (row: IWaitlist) => (!row.slug || row.slug === 'default') ? this.transloco.translate('admin.forms.address_not_set') : row.slug
            },
            {
                key: 'totalSignups',
                header: 'admin.forms.col.signups',
                type: 'html',
                transformFn: (row: IWaitlist) => `
                    <div style="line-height: 1.2;">
                        <div class="fw-bold fs-6">${escapeHtml(this.transloco.translate('admin.forms.signups_confirmed', { count: row.totalSignups || 0 }))}</div>
                        <div class="text-muted small" style="font-size: 0.8rem;">${escapeHtml(this.transloco.translate('admin.forms.signups_total', { count: row.allUsersCount || 0 }))}</div>
                    </div>
                `
            },
            {
                key: 'isActive',
                header: 'common.table.status',
                type: 'badge',
                badgeConfig: {
                    trueClass: 'active',
                    falseClass: 'inactive',
                    textFn: (row: IWaitlist) => this.transloco.translate(row.isActive ? 'admin.forms.active' : 'admin.forms.inactive'),
                },
                classFn: (row: IWaitlist) => row.isActive ? 'active' : 'inactive',
            },
            {
                key: 'actions',
                header: 'common.table.actions',
                type: 'actions',
                actions: [
                    {
                        icon: 'fas fa-pen text-primary',
                        action: 'edit',
                        label: 'admin.forms.actions.edit',
                        class: 'edit',
                        onAction: (row) => this.editWaitlist(row)
                    },
                    {
                        icon: 'fas fa-users text-info',
                        action: 'users',
                        label: 'admin.forms.actions.signups',
                        class: 'edit',
                        onAction: (row) => this.navigateToUsers(row)
                    },
                    {
                        icon: 'fas fa-tags text-secondary',
                        action: 'tags',
                        label: 'admin.forms.actions.tags',
                        class: 'edit',
                        onAction: (row) => this.navigateToTags(row)
                    },
                    {
                        icon: 'fas fa-envelope text-success-emphasis',
                        action: 'templates',
                        label: 'admin.forms.actions.emails',
                        class: 'edit',
                        onAction: (row) => this.navigateToTemplates(row)
                    },
                    {
                        icon: 'fas fa-trash text-danger',
                        action: 'delete',
                        label: 'common.actions.delete',
                        class: 'delete',
                        onAction: (row) => this.deleteWaitlist(row)
                    }
                ]
            }
        ];
    }

    ngOnDestroy(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }

    loadWaitlists(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.loading.set(true);
        this.loadError.set(null);
        // A fresh load counts every form again (see signupCount).
        this.counted.clear();

        const collectionRef = runInInjectionContext(this.injector, () => collection(this.firestore, 'Waitlists'));
        const q = runInInjectionContext(this.injector, () => query(collectionRef, orderBy('createdAt', 'desc')));

        this.unsubscribe = runInInjectionContext(this.injector, () => onSnapshot(q, async (snapshot) => {
            const ticket = ++this.snapTicket;
            const items = await Promise.all(snapshot.docs.map(async (docSnap) => {
                const form = { id: docSnap.id, ...docSnap.data() } as IWaitlist;
                return { ...form, allUsersCount: await this.signupCount(form) } as IWaitlist;
            }));
            if (ticket !== this.snapTicket) return;
            this.waitlists.set(items);
            this.loadError.set(null);
            this.loading.set(false);
        }, (error) => {
            console.error('Loading the forms failed:', error);
            this.loadError.set(true);
            this.loading.set(false);
        }));
    }

    /**
     * All of a form's sign-ups, confirmed or not: one aggregate count per form,
     * read when the list loads (opening the page, or Retry) and again when the
     * form's confirmed count (`totalSignups`) moves. A sign-up that is not yet
     * confirmed does not change the form document, so no snapshot arrives for it:
     * the Total shows it at the next load, not live.
     */
    private async signupCount(form: IWaitlist): Promise<number> {
        const at = form.totalSignups || 0;
        const known = this.counted.get(form.id);
        if (known && known.at === at) return known.count;
        try {
            const usersRef = runInInjectionContext(this.injector, () => collection(this.firestore, 'Waitlists', form.id, 'users'));
            const countSnap = await runInInjectionContext(this.injector, () => getCountFromServer(usersRef));
            const count = countSnap.data().count;
            this.counted.set(form.id, { at, count });
            return count;
        } catch (e) {
            console.error(`Counting the sign-ups of form ${form.id} failed:`, e);
            return known?.count ?? 0;
        }
    }

    openAddDrawer(): void {
        this.currentAction.set('add');
        this.currentWaitlist.set(null);
        this.isDrawerOpen.set(true);
    }

    editWaitlist(waitlist: IWaitlist): void {
        this.currentAction.set('edit');
        this.currentId.set(waitlist.id);
        this.currentWaitlist.set(waitlist);
        this.isDrawerOpen.set(true);
    }

    closeDrawer(): void {
        this.isDrawerOpen.set(false);
        this.currentWaitlist.set(null);
    }

    async onDrawerSaved(formData: WaitlistFormData): Promise<void> {
        try {
            if (this.currentAction() === 'edit') {
                const docRef = doc(this.firestore, 'Waitlists', this.currentId());
                // Canonical targetListIds always includes the form's own system
                // list (U3); the drawer only tracks the additional manual picks.
                const targetListIds = this.withOwnList(this.currentId(), formData.targetListIds);
                await updateDoc(docRef, { ...formData, targetListIds, updatedAt: new Date() });
            } else {
                const collectionRef = collection(this.firestore, 'Waitlists');
                const docRef = doc(collectionRef, formData.slug);
                // The address is the form's id: a second form with the same address
                // would overwrite the first one and its count.
                if ((await getDoc(docRef)).exists()) {
                    this.notify.error('admin.forms.address_taken');
                    return;
                }
                const targetListIds = this.withOwnList(formData.slug, formData.targetListIds);

                await setDoc(docRef, {
                    ...formData,
                    targetListIds,
                    createdAt: new Date(),
                    totalSignups: 0,
                });
            }
            this.closeDrawer();
            this.notify.success('admin.forms.saved');
        } catch (error) {
            console.error('Saving the form failed:', error);
            this.notify.error('admin.forms.save_failed');
        }
    }

    /** Prepend a form's own `waitlist-{id}` system list to its manual list picks. */
    private withOwnList(formId: string, manualPicks: string[] = []): string[] {
        return [...new Set([`waitlist-${formId}`, ...manualPicks.filter(Boolean)])];
    }

    /**
     * Delete a form with its sign-ups and its tags. The server does it
     * (adminDeleteForm), so nothing is left behind and the browser never
     * deletes sign-ups one by one.
     */
    async deleteWaitlist(waitlist: IWaitlist): Promise<void> {
        const count = waitlist.allUsersCount ?? waitlist.totalSignups ?? 0;
        const key = count === 0 ? 'admin.forms.delete_confirm_none'
            : count === 1 ? 'admin.forms.delete_confirm_one'
                : 'admin.forms.delete_confirm';
        const confirmed = await this.confirmDialog.ask({
            titleKey: 'common.dialog.delete',
            dialogMessage: this.transloco.translate(key, { name: escapeHtml(waitlist.name), count }),
            btnText: this.transloco.translate('common.actions.delete'),
            panelType: 'warn',
        });
        if (!confirmed) return;

        try {
            await runInInjectionContext(this.injector, () =>
                arcCallable<{ formId: string }, { deleted: boolean; signups: number; tags: number }>(this.functions, 'adminDeleteForm', { timeout: 300_000 })({ formId: waitlist.id }));
            this.notify.success('admin.forms.deleted');
        } catch (error) {
            console.error('Error deleting form:', error);
            this.notify.error('admin.forms.delete_failed');
        }
    }

    navigateToUsers(waitlist: IWaitlist): void {
        this.router.navigate(['/admin/waitlists/users', waitlist.id]);
    }

    navigateToTemplates(waitlist: IWaitlist): void {
        this.router.navigate(['/admin/waitlists/templates', waitlist.id]);
    }

    navigateToTags(waitlist: IWaitlist): void {
        this.router.navigate(['/admin/waitlists/tags'], {
            queryParams: {
                waitlistId: waitlist.id,
                waitlistName: waitlist.name
            }
        });
    }
}
