/**
 * Email + SMS, SMS Logs: every text message, newest first, like Email Logs.
 * With the Test provider the full message (code included) is here; with a real
 * provider the code is blanked.
 */
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { statusBadgeClass } from '../../../../shared/utils/status-badge';
import { injectT } from '../../../core/i18n/inject-t';
import { SmsLogStore } from './sms-log.store';
import { ISmsLog } from './sms-log.model';

@Component({
    selector: 'arc-sms-logs',
    standalone: true,
    imports: [MatFormFieldModule, MatSelectModule, MatPaginatorModule, MatButtonModule, MatIconModule, RouterLink, TranslocoPipe, GlobalTableComponent, PageHeaderComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
    template: `
        <div class="content-area">
            <arc-page-header [title]="'admin.sms_logs.title' | transloco" [subtitle]="'admin.sms_logs.subtitle' | transloco">
                <a mat-stroked-button routerLink="/admin/settings/sms">
                    <mat-icon>settings</mat-icon> {{ 'admin.sms_logs.settings' | transloco }}
                </a>
                <button mat-stroked-button (click)="refresh()">
                    <mat-icon>refresh</mat-icon> {{ 'admin.sms_logs.refresh' | transloco }}
                </button>
            </arc-page-header>

            <div class="d-flex justify-content-end mb-3">
                <mat-form-field appearance="outline" class="status-filter">
                    <mat-label>{{ 'admin.sms_logs.status' | transloco }}</mat-label>
                    <mat-select [value]="statusFilter()" (selectionChange)="onStatusFilterChange($event.value)">
                        <mat-option value="">{{ 'admin.sms_logs.status_all' | transloco }}</mat-option>
                        <mat-option value="logged">{{ 'admin.settings.sms.status_logged' | transloco }}</mat-option>
                        <mat-option value="sent">{{ 'admin.settings.sms.status_sent' | transloco }}</mat-option>
                        <mat-option value="failed">{{ 'admin.settings.sms.status_failed' | transloco }}</mat-option>
                    </mat-select>
                </mat-form-field>
            </div>

            <app-global-table [data]="store.items()" [columns]="columns" [loading]="store.isLoading()"
                [pageIndex]="currentPage()" [pageSize]="pageSize()" [sortField]="'createdAt'" [sortOrder]="'desc'"
                [emptyTitle]="'admin.sms_logs.empty_title' | transloco"
                [emptyDescription]="'admin.sms_logs.empty_description' | transloco" [showEmptyAction]="false">
            </app-global-table>

            @if (store.items().length) {
                <div class="d-flex justify-content-end">
                    <mat-paginator [length]="store.totalRecords()" [pageSize]="pageSize()" [pageIndex]="currentPage()"
                        [pageSizeOptions]="[10, 25, 50]" [showFirstLastButtons]="true" (page)="onPageChange($event)">
                    </mat-paginator>
                </div>
            }
        </div>
    `,
    styles: [`
        .content-area { padding: 24px; }
        .status-filter { width: 160px; }
        .status-filter ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    `],
})
export default class SmsLogsComponent implements OnInit {
    readonly store = inject(SmsLogStore);
    private readonly t = injectT();

    readonly currentPage = signal(0);
    readonly pageSize = signal(25);
    readonly statusFilter = signal('');

    columns: TableColumn[] = [];

    ngOnInit(): void {
        this.columns = [
            { key: 'index', header: '#', type: 'index' },
            { key: 'createdAt', header: 'admin.settings.sms.col_time', type: 'date', dateFormat: 'MMM d, y HH:mm:ss' },
            { key: 'to', header: 'admin.settings.sms.col_to', type: 'text', classFn: () => 'text-nowrap' },
            {
                key: 'text',
                header: 'admin.settings.sms.col_message',
                type: 'text',
                transformFn: (row: ISmsLog) => (row.error ? `${row.text} (${row.error})` : row.text),
            },
            {
                key: 'purpose',
                header: 'admin.sms_logs.col_purpose',
                type: 'text',
                transformFn: (row: ISmsLog) => (row.purpose === 'test' ? this.t('admin.sms_logs.purpose_test') : this.t('admin.sms_logs.purpose_otp')),
            },
            {
                key: 'status',
                header: 'admin.settings.sms.col_status',
                type: 'badge',
                badgeConfig: { textFn: (row: ISmsLog) => this.statusLabel(row.status) },
                classFn: (row: ISmsLog) => statusBadgeClass(row.status),
            },
            {
                key: 'provider',
                header: 'admin.sms_logs.col_provider',
                type: 'text',
                transformFn: (row: ISmsLog) => (row.provider === 'log' ? this.t('admin.sms_logs.provider_test') : 'MSG91'),
            },
        ];
        this.fetch();
    }

    private statusLabel(status: string): string {
        if (status === 'logged') return this.t('admin.settings.sms.status_logged');
        if (status === 'sent') return this.t('admin.settings.sms.status_sent');
        return this.t('admin.settings.sms.status_failed');
    }

    private fetch(): void {
        const whereConditions = this.statusFilter()
            ? [{ field: 'status', operator: '==' as const, value: this.statusFilter() }]
            : [];
        this.store.getAll({
            limitCount: this.pageSize(),
            currentPageNumber: this.currentPage(),
            previousPageNumber: this.currentPage() - 1,
            orderByField: 'createdAt',
            orderByDirection: 'desc',
            whereConditions,
        });
    }

    refresh(): void {
        this.currentPage.set(0);
        this.fetch();
    }

    onStatusFilterChange(value: string): void {
        this.statusFilter.set(value);
        this.refresh();
    }

    onPageChange(event: PageEvent): void {
        this.currentPage.set(event.pageIndex);
        this.pageSize.set(event.pageSize);
        this.fetch();
    }
}
