import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Functions } from '@angular/fire/functions';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { arcCallable } from '../../../../core/config/arc-functions';
import { AppListCondition, AppListOp } from '../../(audience)/audience.model';
import { APP_USERS_LIMIT_NOTE } from '../../(app-users)/app-users-limit';

export interface AppListPreview {
    matched: number;
    withEmail: number;
    /** People whose address another matching person also has; each address is emailed once. */
    sharedEmail?: number;
    /** Addresses a send would email, one per address. */
    subscribed: number;
    scanned: number;
    truncated: boolean;
}

/** Operators in the order the admin sees them. `value` says what the value box expects. */
export const APP_LIST_OPERATORS: Array<{ op: AppListOp; label: string; value: 'text' | 'list' | 'none' }> = [
    { op: 'is', label: 'is', value: 'text' },
    { op: 'is_not', label: 'is not', value: 'text' },
    { op: 'any_of', label: 'is any of', value: 'list' },
    { op: 'contains', label: 'contains', value: 'text' },
    { op: 'gt', label: 'is greater than', value: 'text' },
    { op: 'lt', label: 'is less than', value: 'text' },
    { op: 'empty', label: 'is empty', value: 'none' },
    { op: 'not_empty', label: 'is not empty', value: 'none' },
];

/** A condition row as edited: `any of` values are typed comma-separated. */
interface Row {
    field: string;
    op: AppListOp;
    text: string;
}

const PREVIEW_DELAY_MS = 600;

/**
 * Conditions of an App users (live) list (specs/coexistence-spec.md 5b, CO6.5b):
 * rows of field, operator and value, all of which must match. Fields come from
 * a sample of the host app's documents, so the admin picks paths instead of
 * typing them. Every change re-counts who matches, after a short pause.
 */
@Component({
    selector: 'arc-app-list-conditions',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <p class="small text-muted mb-2">
        People from your app who match <strong>all</strong> of these conditions. Nobody is added by hand:
        the list follows your app's data, and is checked again every time it is used.
    </p>

    @for (row of rows(); track $index; let i = $index) {
        <div class="condition-row d-flex gap-2 align-items-start flex-wrap mb-1">
            <mat-form-field appearance="outline" class="cond-field">
                <mat-label>Field</mat-label>
                @if (fields().length) {
                    <mat-select [ngModel]="row.field" (ngModelChange)="update(i, { field: $event })">
                        @for (f of fields(); track f) { <mat-option [value]="f">{{ f }}</mat-option> }
                        @if (row.field && !fields().includes(row.field)) { <mat-option [value]="row.field">{{ row.field }}</mat-option> }
                    </mat-select>
                } @else {
                    <!-- No sample of the app's fields (still loading, or none): type the path. -->
                    <input matInput placeholder="for example plan.tier" [ngModel]="row.field" (ngModelChange)="update(i, { field: $event.trim() })" />
                }
            </mat-form-field>
            <mat-form-field appearance="outline" class="cond-op">
                <mat-label>Condition</mat-label>
                <mat-select [ngModel]="row.op" (ngModelChange)="update(i, { op: $event })">
                    @for (o of operators; track o.op) { <mat-option [value]="o.op">{{ o.label }}</mat-option> }
                </mat-select>
            </mat-form-field>
            @if (valueKind(row.op) !== 'none') {
                <mat-form-field appearance="outline" class="cond-value">
                    <mat-label>{{ valueKind(row.op) === 'list' ? 'Values, comma-separated' : 'Value' }}</mat-label>
                    <input matInput [ngModel]="row.text" (ngModelChange)="update(i, { text: $event })" />
                </mat-form-field>
            }
            <button mat-icon-button type="button" (click)="remove(i)" aria-label="Remove condition"><mat-icon>close</mat-icon></button>
        </div>
    }
    <button mat-stroked-button type="button" (click)="add()"><mat-icon>add</mat-icon> Add condition</button>

    <div class="app-list-preview small mt-3" aria-live="polite">
        @if (previewError()) {
            <span class="text-danger">Could not count matches: {{ previewError() }}</span>
        } @else if (preview(); as p) {
            <strong>Matches {{ p.matched }}</strong> of {{ p.scanned }} people in your app;
            {{ p.subscribed }} can be emailed now{{ unsubscribedOf(p) ? ' (' + unsubscribedOf(p) + ' unsubscribed)' : '' }}.
            @if (p.matched > p.withEmail) { {{ p.matched - p.withEmail }} have no email address. }
            @if (p.sharedEmail) { {{ p.sharedEmail }} share an address with someone else here, and each address gets one email. }
            @if (p.truncated) { <div class="text-warning mt-1"><i class="fas fa-triangle-exclamation me-1"></i>{{ limitNote }}</div> }
        } @else {
            <span class="text-muted">Counting matches...</span>
        }
    </div>
    `,
    styles: [`
        .cond-field { flex: 1 1 180px; }
        .cond-op { flex: 0 1 170px; }
        .cond-value { flex: 1 1 160px; }
    `],
})
export class AppListConditionsComponent implements OnInit, OnDestroy {
    readonly limitNote = APP_USERS_LIMIT_NOTE;

    /** Addresses that unsubscribed: one per address, as a send counts them. */
    unsubscribedOf(p: AppListPreview): number {
        return Math.max(0, p.withEmail - (p.sharedEmail ?? 0) - p.subscribed);
    }
    @Input() set conditions(value: AppListCondition[] | undefined) {
        // The parent hands back what this component just emitted. Rebuilding the
        // rows from it would drop a row still being filled in (no field yet),
        // which is left out of the emitted conditions: keep the rows then.
        if (JSON.stringify(value ?? []) === JSON.stringify(this.current())) return;
        this.rows.set((value ?? []).map((c) => ({
            field: c.field,
            op: c.op,
            text: Array.isArray(c.value) ? c.value.join(', ') : c.value ?? '',
        })));
    }
    @Output() conditionsChange = new EventEmitter<AppListCondition[]>();

    private functions = inject(Functions);
    private timer: ReturnType<typeof setTimeout> | undefined;
    private previewRun = 0;

    readonly operators = APP_LIST_OPERATORS;
    rows = signal<Row[]>([]);
    fields = signal<string[]>([]);
    preview = signal<AppListPreview | null>(null);
    previewError = signal('');

    async ngOnInit(): Promise<void> {
        this.schedulePreview(0);
        try {
            const res = await arcCallable<unknown, { fields: Array<{ path: string }> }>(this.functions, 'sampleAppUsers')({});
            this.fields.set(res.data.fields.map((f) => f.path).sort((a, b) => a.localeCompare(b)));
        } catch {
            // The field list is a convenience; saved conditions still show and work.
        }
    }

    ngOnDestroy(): void {
        clearTimeout(this.timer);
    }

    valueKind(op: AppListOp): 'text' | 'list' | 'none' {
        return this.operators.find((o) => o.op === op)?.value ?? 'text';
    }

    add(): void {
        this.rows.update((rows) => [...rows, { field: this.fields()[0] ?? '', op: 'is', text: '' }]);
        this.changed();
    }

    remove(index: number): void {
        this.rows.update((rows) => rows.filter((_, i) => i !== index));
        this.changed();
    }

    update(index: number, patch: Partial<Row>): void {
        this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
        this.changed();
    }

    /** The rows as saved conditions; a row without a field is left out. */
    current(): AppListCondition[] {
        return this.rows()
            .filter((r) => r.field)
            .map((r) => {
                const kind = this.valueKind(r.op);
                if (kind === 'none') return { field: r.field, op: r.op };
                if (kind === 'list') return { field: r.field, op: r.op, value: r.text.split(',').map((v) => v.trim()).filter(Boolean) };
                return { field: r.field, op: r.op, value: r.text.trim() };
            });
    }

    private changed(): void {
        this.conditionsChange.emit(this.current());
        this.schedulePreview(PREVIEW_DELAY_MS);
    }

    private schedulePreview(delay: number): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.runPreview(), delay);
    }

    async runPreview(): Promise<void> {
        const run = ++this.previewRun;
        this.previewError.set('');
        try {
            const res = await arcCallable<{ conditions: AppListCondition[] }, AppListPreview>(this.functions, 'previewAppList')({ conditions: this.current() });
            if (run === this.previewRun) this.preview.set(res.data);
        } catch (e: any) {
            if (run === this.previewRun) this.previewError.set(e?.message || String(e));
        }
    }
}
