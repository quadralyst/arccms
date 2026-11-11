import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, Injector, runInInjectionContext, signal } from '@angular/core';
import { Firestore, collection, query, where, getDocs, Timestamp } from '@angular/fire/firestore';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';

interface HealthCounts {
    success: number; failed: number; retrying: number; deferred: number;
    skipped: number; suppressed: number; pending: number; total: number;
}

/**
 * Admin email health card (Phase 8 ops): last-24h EmailLogs by status.
 * Self-contained — queries EmailLogs where createdAt >= 24h ago (single-field
 * index) and buckets client-side.
 */
@Component({
    selector: 'arc-email-health-card',
    standalone: true,
    imports: [CommonModule, MatIconModule, TranslocoPipe],
    template: `
    <div class="border rounded p-3 mb-3">
        <div class="d-flex justify-content-between align-items-center mb-2">
            <strong><mat-icon class="align-middle" aria-hidden="true">monitor_heart</mat-icon> {{ 'common.email_health.title' | transloco }}</strong>
            @if (loading()) { <span class="small text-muted" role="status">{{ 'common.state.loading' | transloco }}</span> }
        </div>
        @if (loadFailed()) {
        <div class="small text-danger" role="alert">{{ 'common.email_health.load_failed' | transloco }}</div>
        } @else {
        <div class="d-flex gap-3 flex-wrap">
            <span class="badge bg-success">{{ 'common.email_health.sent' | transloco: { count: counts().success } }}</span>
            <span class="badge bg-danger">{{ 'common.email_health.failed' | transloco: { count: counts().failed } }}</span>
            <span class="badge bg-warning text-dark">{{ 'common.email_health.retrying' | transloco: { count: counts().retrying } }}</span>
            <span class="badge bg-info text-dark">{{ 'common.email_health.deferred' | transloco: { count: counts().deferred } }}</span>
            <span class="badge bg-secondary">{{ 'common.email_health.skipped' | transloco: { count: counts().skipped } }}</span>
            <span class="badge bg-dark">{{ 'common.email_health.suppressed' | transloco: { count: counts().suppressed } }}</span>
            <span class="badge bg-light text-dark">{{ 'common.email_health.pending' | transloco: { count: counts().pending } }}</span>
            <span class="ms-auto small text-muted">{{ 'common.email_health.total' | transloco: { count: counts().total } }}</span>
        </div>
        @if (counts().failed > 0) {
        <div class="small text-danger mt-2">{{ 'common.email_health.failed_note' | transloco: { count: counts().failed } }}</div>
        }
        }
    </div>`,
})
export class EmailHealthCardComponent implements OnInit {
    private firestore = inject(Firestore);
    private injector = inject(Injector);
    loading = signal(true);
    /** The counts did not load: says so, rather than showing zeros. */
    loadFailed = signal(false);
    counts = signal<HealthCounts>({ success: 0, failed: 0, retrying: 0, deferred: 0, skipped: 0, suppressed: 0, pending: 0, total: 0 });

    async ngOnInit(): Promise<void> {
        try {
            const cutoff = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
            const snap = await runInInjectionContext(this.injector, () =>
                getDocs(query(collection(this.firestore, 'EmailLogs'), where('createdAt', '>=', cutoff))));
            const c: HealthCounts = { success: 0, failed: 0, retrying: 0, deferred: 0, skipped: 0, suppressed: 0, pending: 0, total: 0 };
            snap.forEach((d) => {
                const s = (d.data()['status'] as keyof HealthCounts) || 'pending';
                if (s in c && s !== 'total') (c[s] as number)++;
                c.total++;
            });
            this.counts.set(c);
        } catch (e) {
            console.error('EmailHealthCard: failed to load', e);
            this.loadFailed.set(true);
        } finally {
            this.loading.set(false);
        }
    }
}
