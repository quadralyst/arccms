import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, Injector, runInInjectionContext, signal } from '@angular/core';
import { Firestore, collection, query, where, getDocs, Timestamp } from '@angular/fire/firestore';
import { MatIconModule } from '@angular/material/icon';

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
    imports: [CommonModule, MatIconModule],
    template: `
    <div class="border rounded p-3 mb-3">
        <div class="d-flex justify-content-between align-items-center mb-2">
            <strong><mat-icon class="align-middle">monitor_heart</mat-icon> Email health — last 24h</strong>
            @if (loading()) { <span class="small text-muted">loading…</span> }
        </div>
        <div class="d-flex gap-3 flex-wrap">
            <span class="badge bg-success">{{ counts().success }} sent</span>
            <span class="badge bg-danger">{{ counts().failed }} failed</span>
            <span class="badge bg-warning text-dark">{{ counts().retrying }} retrying</span>
            <span class="badge bg-info text-dark">{{ counts().deferred }} deferred</span>
            <span class="badge bg-secondary">{{ counts().skipped }} skipped</span>
            <span class="badge bg-dark">{{ counts().suppressed }} suppressed</span>
            <span class="badge bg-light text-dark">{{ counts().pending }} pending</span>
            <span class="ms-auto small text-muted">{{ counts().total }} total</span>
        </div>
        @if (counts().failed > 0) {
        <div class="small text-danger mt-2">⚠ {{ counts().failed }} email(s) failed in the last 24h — check the logs below.</div>
        }
    </div>`,
})
export class EmailHealthCardComponent implements OnInit {
    private firestore = inject(Firestore);
    private injector = inject(Injector);
    loading = signal(true);
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
        } finally {
            this.loading.set(false);
        }
    }
}
