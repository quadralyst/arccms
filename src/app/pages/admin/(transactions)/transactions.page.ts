import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { roleGuard } from '../../../guards/role.guard';
import { TransactionsStore } from './transactions.store';

export const routeMeta: RouteMeta = {
    title: 'Transactions | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [CommonModule, FormsModule, MatCardModule, MatTableModule, MatFormFieldModule, MatSelectModule, PageHeaderComponent, TranslocoPipe],
    template: `
        <div class="transactions-page">
            <arc-page-header [title]="'admin.transactions.title' | transloco"
                [subtitle]="'admin.transactions.subtitle' | transloco">
                <mat-form-field appearance="outline" class="mb-0">
                    <mat-label>{{ 'common.table.status' | transloco }}</mat-label>
                    <mat-select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
                        <mat-option value="">{{ 'common.filters.all' | transloco }}</mat-option>
                        <mat-option value="succeeded">{{ 'admin.transactions.succeeded' | transloco }}</mat-option>
                        <mat-option value="failed">{{ 'admin.transactions.failed' | transloco }}</mat-option>
                        <mat-option value="refunded">{{ 'admin.transactions.refunded' | transloco }}</mat-option>
                        <mat-option value="pending">{{ 'admin.transactions.pending' | transloco }}</mat-option>
                    </mat-select>
                </mat-form-field>
            </arc-page-header>

            <mat-card>
                <mat-card-content class="pt-3">
                    @if (store.isLoading()) {
                        <p class="text-muted">{{ 'common.state.loading' | transloco }}</p>
                    } @else if (filtered().length === 0) {
                        <p class="text-muted">{{ 'admin.transactions.none' | transloco }}</p>
                    } @else {
                        <table mat-table [dataSource]="filtered()" class="w-100">
                            <ng-container matColumnDef="createdAt"><th mat-header-cell *matHeaderCellDef>{{ 'admin.transactions.col_date' | transloco }}</th><td mat-cell *matCellDef="let t">{{ t.createdAt.seconds * 1000 | date:'short' }}</td></ng-container>
                            <ng-container matColumnDef="userEmail"><th mat-header-cell *matHeaderCellDef>{{ 'admin.transactions.col_customer' | transloco }}</th><td mat-cell *matCellDef="let t">{{ t.userEmail }}</td></ng-container>
                            <ng-container matColumnDef="amount"><th mat-header-cell *matHeaderCellDef>{{ 'admin.transactions.col_amount' | transloco }}</th><td mat-cell *matCellDef="let t">{{ t.currency }} {{ t.amount }}</td></ng-container>
                            <ng-container matColumnDef="premiumType"><th mat-header-cell *matHeaderCellDef>{{ 'admin.transactions.col_plan' | transloco }}</th><td mat-cell *matCellDef="let t">{{ t.premiumType }}</td></ng-container>
                            <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>{{ 'common.table.status' | transloco }}</th><td mat-cell *matCellDef="let t"><span class="status status-{{ t.status }}">{{ t.status }}</span></td></ng-container>
                            <ng-container matColumnDef="eventType"><th mat-header-cell *matHeaderCellDef>{{ 'admin.transactions.col_event' | transloco }}</th><td mat-cell *matCellDef="let t">{{ t.eventType }}</td></ng-container>
                            <tr mat-header-row *matHeaderRowDef="columns"></tr>
                            <tr mat-row *matRowDef="let row; columns: columns"></tr>
                        </table>
                    }
                </mat-card-content>
            </mat-card>
        </div>
    `,
    styles: [`
        .transactions-page { padding: 24px; }
        table { background: #fff; }
        .status { padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; text-transform: capitalize; }
        .status-succeeded { background: #d1e7dd; color: #0f5132; }
        .status-failed { background: #f8d7da; color: #842029; }
        .status-refunded { background: #fff3cd; color: #664d03; }
        .status-pending { background: #e2e3e5; color: #41464b; }
    `],
})
export default class TransactionsPageComponent extends BaseComponent implements OnInit {
    store = inject(TransactionsStore);
    columns = ['createdAt', 'userEmail', 'amount', 'premiumType', 'status', 'eventType'];
    statusFilter = signal('');

    filtered = computed(() => {
        const f = this.statusFilter();
        const items = this.store.items();
        return f ? items.filter((t) => t.status === f) : items;
    });

    ngOnInit(): void {
        this.store.getAll();
    }
}
