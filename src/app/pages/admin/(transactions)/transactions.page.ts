import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
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
    imports: [CommonModule, FormsModule, MatCardModule, MatTableModule, MatFormFieldModule, MatSelectModule, PageHeaderComponent],
    template: `
        <div class="transactions-page">
            <arc-page-header title="Transactions"
                subtitle="Payment records from Dodo. Raw webhook payloads are stored in the WebhookEvents collection for debugging.">
                <mat-form-field appearance="outline" class="mb-0">
                    <mat-label>Status</mat-label>
                    <mat-select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
                        <mat-option value="">All</mat-option>
                        <mat-option value="succeeded">Succeeded</mat-option>
                        <mat-option value="failed">Failed</mat-option>
                        <mat-option value="refunded">Refunded</mat-option>
                        <mat-option value="pending">Pending</mat-option>
                    </mat-select>
                </mat-form-field>
            </arc-page-header>

            <mat-card>
                <mat-card-content class="pt-3">
                    @if (store.isLoading()) {
                        <p class="text-muted">Loading…</p>
                    } @else if (filtered().length === 0) {
                        <p class="text-muted">No transactions.</p>
                    } @else {
                        <table mat-table [dataSource]="filtered()" class="w-100">
                            <ng-container matColumnDef="createdAt"><th mat-header-cell *matHeaderCellDef>Date</th><td mat-cell *matCellDef="let t">{{ t.createdAt.seconds * 1000 | date:'short' }}</td></ng-container>
                            <ng-container matColumnDef="userEmail"><th mat-header-cell *matHeaderCellDef>Customer</th><td mat-cell *matCellDef="let t">{{ t.userEmail }}</td></ng-container>
                            <ng-container matColumnDef="amount"><th mat-header-cell *matHeaderCellDef>Amount</th><td mat-cell *matCellDef="let t">{{ t.currency }} {{ t.amount }}</td></ng-container>
                            <ng-container matColumnDef="premiumType"><th mat-header-cell *matHeaderCellDef>Plan</th><td mat-cell *matCellDef="let t">{{ t.premiumType }}</td></ng-container>
                            <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>Status</th><td mat-cell *matCellDef="let t"><span class="status status-{{ t.status }}">{{ t.status }}</span></td></ng-container>
                            <ng-container matColumnDef="eventType"><th mat-header-cell *matHeaderCellDef>Event</th><td mat-cell *matCellDef="let t">{{ t.eventType }}</td></ng-container>
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
