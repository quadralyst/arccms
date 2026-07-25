/**
 * Waitlists Admin Page
 *
 * Main admin page for managing waitlists.
 */

import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, Injector, inject, runInInjectionContext, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Firestore, collection, onSnapshot, updateDoc, deleteDoc, doc, query, orderBy, setDoc, getCountFromServer } from '@angular/fire/firestore';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { EmailConfigStatusService } from '../../../../shared/services/email-config-status.service';
import { roleGuard } from '../../../guards/role.guard';
import { WaitlistEditDrawerComponent, WaitlistFormData } from './edit-drawer/waitlist-edit-drawer.component';

export const routeMeta: RouteMeta = {
    title: 'Waitlists | Arc CMS',
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
    startingPoint?: number;
    allUsersCount?: number;
    defaultTagId?: string;
    targetListIds?: string[];
    gamificationEnabled?: boolean;
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
        PageHeaderComponent
    ],
})
export default class WaitlistsComponent implements OnInit, OnDestroy {
    private router = inject(Router);
    private firestore = inject(Firestore);
    private dialog = inject(MatDialog);
    private sanitizer = inject(DomSanitizer);
    private injector = inject(Injector);

    // Email configuration status
    emailConfigService = inject(EmailConfigStatusService);

    // State signals
    waitlists = signal<IWaitlist[]>([]);
    loading = signal(true);
    isDrawerOpen = signal(false);
    currentAction = signal<'add' | 'edit'>('add');
    currentId = signal('');
    currentWaitlist = signal<IWaitlist | null>(null);

    private unsubscribe: (() => void) | null = null;

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
                header: 'Name',
                classFn: () => 'fw-bold'
            },
            {
                key: 'slug',
                header: 'Slug',
                type: 'code',
                transformFn: (row: IWaitlist) => (!row.slug || row.slug === 'default') ? '<not specified>' : row.slug
            },
            {
                key: 'totalSignups',
                header: 'Email Subscribers',
                type: 'html',
                transformFn: (row: IWaitlist) => `
                    <div style="line-height: 1.2;">
                        <div class="fw-bold fs-6">${row.totalSignups || 0} Verified</div>
                        <div class="text-muted small" style="font-size: 0.8rem;">${row.allUsersCount || 0} Total</div>
                    </div>
                `
            },
            {
                key: 'isActive',
                header: 'Status',
                type: 'badge',
                badgeConfig: {
                    trueClass: 'active',
                    falseClass: 'inactive',
                    trueText: 'Active',
                    falseText: 'Inactive'
                }
            },
            {
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    {
                        icon: 'fas fa-pen text-primary',
                        action: 'edit',
                        label: 'Edit',
                        class: 'edit',
                        onAction: (row) => this.editWaitlist(row)
                    },
                    {
                        icon: 'fas fa-users text-info',
                        action: 'users',
                        label: 'View Users',
                        class: 'edit',
                        onAction: (row) => this.navigateToUsers(row)
                    },
                    {
                        icon: 'fas fa-tags text-secondary',
                        action: 'tags',
                        label: 'Manage Tags',
                        class: 'edit',
                        onAction: (row) => this.navigateToTags(row)
                    },
                    {
                        icon: 'fas fa-envelope text-success-emphasis',
                        action: 'templates',
                        label: 'Email Templates',
                        class: 'edit',
                        onAction: (row) => this.navigateToTemplates(row)
                    },
                    {
                        icon: 'fas fa-trophy text-warning',
                        action: 'leaderboard',
                        label: 'View Leaderboard',
                        class: 'edit',
                        onAction: (row) => this.navigateToLeaderboard(row)
                    },
                    {
                        icon: 'fas fa-trash text-danger',
                        action: 'delete',
                        label: 'Delete',
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

    async loadWaitlists(): Promise<void> {
        const collectionRef = runInInjectionContext(this.injector, () => collection(this.firestore, 'Waitlists'));
        const q = runInInjectionContext(this.injector, () => query(collectionRef, orderBy('createdAt', 'desc')));

        this.unsubscribe = runInInjectionContext(this.injector, () => onSnapshot(q, async (snapshot) => {
            const promises = snapshot.docs.map(async (docSnap) => {
                const data = docSnap.data();
                const id = docSnap.id;

                // Fetch total count of users (verified + unverified)
                try {
                    const usersRef = runInInjectionContext(this.injector, () => collection(this.firestore, 'Waitlists', id, 'users'));
                    const countSnap = await runInInjectionContext(this.injector, () => getCountFromServer(usersRef));
                    return {
                        id,
                        ...data,
                        allUsersCount: countSnap.data().count
                    } as IWaitlist;
                } catch (e) {
                    console.error(`Error fetching count for waitlist ${id}`, e);
                    return { id, ...data, allUsersCount: 0 } as IWaitlist;
                }
            });

            const items = await Promise.all(promises);
            this.waitlists.set(items);
            this.loading.set(false);
        }, (error) => {
            console.error('Error loading waitlists:', error);
            this.loading.set(false);
        }));
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
                const targetListIds = this.withOwnList(formData.slug, formData.targetListIds);

                await setDoc(docRef, {
                    ...formData,
                    targetListIds,
                    createdAt: new Date(),
                    totalSignups: 0,
                });
            }
            this.closeDrawer();
        } catch (error) {
            console.error('Error saving waitlist:', error);
        }
    }

    /** Prepend a form's own `waitlist-{id}` system list to its manual list picks. */
    private withOwnList(formId: string, manualPicks: string[] = []): string[] {
        return [...new Set([`waitlist-${formId}`, ...manualPicks.filter(Boolean)])];
    }

    async deleteWaitlist(waitlist: IWaitlist): Promise<void> {
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Are you sure you want to delete <strong>${waitlist.name}</strong>?`
        );

        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            width: '350px',
            data: {
                dialogType: 'Delete',
                dialogMessage: msg,
                btnText: 'Delete',
                panelType: 'warn',
            },
        });

        dialogRef.afterClosed().subscribe(async (result: any) => {
            if (!!result) {
                try {
                    const docRef = runInInjectionContext(this.injector, () => doc(this.firestore, 'Waitlists', waitlist.id));
                    await runInInjectionContext(this.injector, () => deleteDoc(docRef));
                } catch (error) {
                    console.error('Error deleting waitlist:', error);
                }
            }
        });
    }

    navigateToUsers(waitlist: IWaitlist): void {
        this.router.navigate(['/admin/waitlists/users', waitlist.id]);
    }

    navigateToTemplates(waitlist: IWaitlist): void {
        this.router.navigate(['/admin/waitlists/templates', waitlist.id]);
    }

    navigateToLeaderboard(waitlist: IWaitlist): void {
        this.router.navigate(['/leaderboard/', waitlist.slug]);
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
