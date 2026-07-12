import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal, ViewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Firestore, collection, collectionData, doc, getDoc, query, where } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Subscription } from 'rxjs';

import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { ToastService } from '../../../../shared/services/toast.service';

import { EmailLogStore } from './email-log.store';
import { IEmailLog } from './email-log.model';
import ViewEmailLogComponent from './(view-email-log)/view-email-log.component';
import { EmailHealthCardComponent } from '../../../../shared/components/email-health-card/email-health-card.component';

interface ActiveBroadcast {
    id: string;
    subject: string;
    status: string;
    totalCount: number;
    sentCount: number;
    failedCount: number;
}

@Component({
    selector: 'arc-email-logs',
    standalone: true,
    imports: [
        CommonModule,
        MatSidenavModule,
        MatIconModule,
        MatButtonModule,
        MatPaginatorModule,
        MatProgressBarModule,
        MatDialogModule,
        MatSelectModule,
        MatFormFieldModule,
        GlobalTableComponent,
        ViewEmailLogComponent,
        EmailHealthCardComponent,
    ],
    providers: [DatePipe],
    templateUrl: './email-logs.html',
    styleUrl: './email-logs.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class EmailLogsComponent implements OnInit, OnDestroy {
    @ViewChild('drawer') drawer!: MatDrawer;

    emailLogStore = inject(EmailLogStore);
    private functions = inject(Functions);
    private firestore = inject(Firestore);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    dialog = inject(MatDialog);
    sanitizer = inject(DomSanitizer);
    toastService = inject(ToastService);

    // State signals
    currentId = signal('');
    currentPage = signal(0);
    pageSize = signal(10);
    sortField = signal('createdAt');
    sortOrder = signal<'asc' | 'desc'>('desc');
    statusFilter = signal('');
    isPurging = signal(false);
    retentionDays = signal(60);

    // Active broadcast progress
    activeBroadcasts = signal<ActiveBroadcast[]>([]);
    private broadcastSub?: Subscription;

    allLogs = computed(() => this.emailLogStore.items() || []);

    // Table columns
    tableColumns: TableColumn[] = [];

    constructor() {
        // Initialize from URL query params (Fix 10: plain code instead of effect)
        const params = this.route.snapshot.queryParams;
        if (params['page']) this.currentPage.set(+params['page']);
        if (params['pageSize']) this.pageSize.set(+params['pageSize']);
        if (params['sortField']) this.sortField.set(params['sortField']);
        if (params['sortOrder']) this.sortOrder.set(params['sortOrder'] as 'asc' | 'desc');
        if (params['status']) this.statusFilter.set(params['status']);
    }

    ngOnInit(): void {
        this.initColumns();
        this.fetchData();
        this.subscribeToActiveBroadcasts();
        this.loadRetentionDays();
    }

    /** Load retention days from Settings/email.autoPurge (Fix 9) */
    private loadRetentionDays(): void {
        getDoc(doc(this.firestore, 'Settings', 'email')).then((snap) => {
            const data = snap.data() as Record<string, any> | undefined;
            if (data?.['autoPurge']?.retentionDays) {
                this.retentionDays.set(data['autoPurge'].retentionDays);
            }
        }).catch((err) => {
            console.warn('Could not load retention settings:', err);
        });
    }

    ngOnDestroy(): void {
        this.broadcastSub?.unsubscribe();
    }

    /** Subscribe to active broadcasts for progress banner */
    private subscribeToActiveBroadcasts(): void {
        const broadcastsRef = collection(this.firestore, 'BroadcastEmails');
        const q = query(
            broadcastsRef,
            where('status', 'in', ['queued', 'processing', 'paused']),
        );
        this.broadcastSub = collectionData(q, { idField: 'id' }).subscribe({
            next: (docs) => {
                const typedDocs = docs as Record<string, any>[];
                this.activeBroadcasts.set(
                    typedDocs.map((d) => ({
                        id: d['id'] as string,
                        subject: d['subject'] || '(no subject)',
                        status: d['status'],
                        totalCount: d['totalCount'] || 0,
                        sentCount: d['sentCount'] || 0,
                        failedCount: d['failedCount'] || 0,
                    })),
                );
            },
            error: (err: unknown) => {
                console.error('Error subscribing to active broadcasts:', err);
            },
        });
    }

    private fetchData(): void {
        const whereConditions: any[] = [];

        if (this.statusFilter()) {
            whereConditions.push({
                field: 'status',
                operator: '==',
                value: this.statusFilter(),
            });
        }

        this.emailLogStore.getAll({
            limitCount: this.pageSize(),
            currentPageNumber: this.currentPage(),
            previousPageNumber: this.currentPage() - 1,
            orderByField: this.sortField(),
            orderByDirection: this.sortOrder(),
            whereConditions,
        });
    }

    // Drawer
    openView(id: string): void {
        this.currentId.set(id);
        this.drawer?.open();
    }

    closeDrawer(): void {
        this.drawer?.close();
        this.currentId.set('');
    }

    // Pagination
    onPageChange(event: PageEvent): void {
        this.currentPage.set(event.pageIndex);
        this.pageSize.set(event.pageSize);
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { page: event.pageIndex, pageSize: event.pageSize },
            queryParamsHandling: 'merge',
        });
        this.fetchData();
    }

    // Sorting
    setSortField(field: string): void {
        if (this.sortField() === field) {
            this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
        } else {
            this.sortField.set(field);
            this.sortOrder.set('asc');
        }
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { sortField: this.sortField(), sortOrder: this.sortOrder() },
            queryParamsHandling: 'merge',
        });
        this.fetchData();
    }

    // Status filter
    onStatusFilterChange(value: string): void {
        this.statusFilter.set(value);
        this.currentPage.set(0);
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { status: value || null, page: 0 },
            queryParamsHandling: 'merge',
        });
        this.fetchData();
    }

    // Record count helpers
    getStartRecord(): number {
        const total = this.emailLogStore.totalRecords();
        if (total === 0) return 0;
        return this.currentPage() * this.pageSize() + 1;
    }

    getEndRecord(): number {
        const total = this.emailLogStore.totalRecords();
        const end = (this.currentPage() + 1) * this.pageSize();
        return Math.min(end, total);
    }

    // Purge old logs
    purgeOldLogs(): void {
        const days = this.retentionDays();
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Are you sure you want to delete all email logs older than <strong>${days} days</strong>? This action cannot be undone.`,
        );

        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            width: '400px',
            data: {
                dialogType: 'Purge',
                dialogMessage: msg,
                btnText: 'Purge Old Logs',
                panelType: 'warn',
            },
        });

        dialogRef.afterClosed().subscribe((result: boolean) => {
            if (result) {
                this.isPurging.set(true);
                const callable = httpsCallable(this.functions, 'purgeEmailLogs');
                callable({ daysOld: days })
                    .then((res: any) => {
                        this.toastService.success(`Purged ${res.data.deletedCount} email log(s) older than ${days} days.`);
                        this.fetchData();
                    })
                    .catch((err) => {
                        this.toastService.error('Failed to purge logs: ' + err.message);
                    })
                    .finally(() => {
                        this.isPurging.set(false);
                    });
            }
        });
    }

    // Cell click handler
    onCellClick(event: { key: string; row: any }): void {
        if (event.key === 'toEmail') {
            this.openView(event.row.id);
        }
    }

    initColumns(): void {
        this.tableColumns = [
            {
                key: 'index',
                header: '#',
                type: 'index',
            },
            {
                key: 'toEmail',
                header: 'Recipient',
                clickable: true,
                classFn: () => 'fw-bold cursor-pointer text-primary',
            },
            {
                key: 'processedSubject',
                header: 'Subject',
                type: 'text',
                transformFn: (row: IEmailLog) => row.processedSubject || row.subject || '(no subject)',
            },
            {
                key: 'type',
                header: 'Type',
                type: 'text',
                transformFn: (row: IEmailLog) =>
                    (row.type || '')
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, (c) => c.toUpperCase()),
            },
            {
                key: 'status',
                header: 'Status',
                type: 'badge',
                badgeConfig: {
                    trueClass: 'active',
                    falseClass: 'inactive',
                    trueText: 'Success',
                    falseText: 'Failed',
                },
                transformFn: (row: IEmailLog) =>
                    row.status === 'success' || row.status === 'delivered' || row.status === 'sent',
            },
            {
                key: 'activeProvider',
                header: 'Provider',
                type: 'text',
                transformFn: (row: IEmailLog) =>
                    (row.activeProvider || '').toUpperCase() || '-',
            },
            {
                key: 'createdAt',
                header: 'Sent Date',
                type: 'date',
                sortable: true,
                dateFormat: 'MMM d, y HH:mm',
            },
            {
                key: 'isOpened',
                header: 'Opened',
                type: 'badge',
                badgeConfig: {
                    trueClass: 'active',
                    falseClass: 'inactive',
                    trueText: 'Yes',
                    falseText: 'No',
                },
            },
            {
                key: 'actions',
                header: '',
                type: 'actions',
                actions: [
                    {
                        action: 'view',
                        icon: 'fas fa-eye text-secondary',
                        label: 'View',
                        class: 'view',
                        onAction: (row: IEmailLog) => this.openView(row.id),
                    },
                ],
            },
        ];
    }
}
