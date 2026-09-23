import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions } from '@angular/fire/functions';
import { TranslocoPipe } from '@jsverse/transloco';
import { arcCallable } from '../../../core/config/arc-functions';

/** The importAppUsers callable's answer (functions/src/users/appUsers.ts). */
export interface ImportAppUsersResult {
    dryRun: boolean;
    scanned: number;
    imported: number;
    alreadyPresent: number;
    skippedNoEmail: number;
    welcomeEmails: number;
}

/**
 * Import app users (docs/coexistence-spec.md, CO6): gives every Firebase Auth
 * account in the project that ArcCMS does not know a user record, as an app user
 * whose login belongs to the host app.
 *
 * Opens with a dry run, so the admin sees what will happen before anything is
 * written. Welcome emails are off unless ticked, and the box says how many would
 * go out: importing thousands of existing users must not email them all by
 * accident. Closes with the import's result, or undefined when cancelled.
 */
@Component({
    selector: 'arc-import-app-users-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule, MatButtonModule, MatCheckboxModule, MatProgressSpinnerModule, TranslocoPipe,
        MatDialogTitle, MatDialogContent, MatDialogActions,
    ],
    template: `
        <h2 mat-dialog-title>{{ 'admin.users.import' | transloco }}</h2>
        <mat-dialog-content>
            <p class="text-muted small">{{ 'admin.users.import_intro' | transloco }}</p>
            @if (preview(); as p) {
                <p>{{ 'admin.users.import_counts' | transloco: { imported: p.imported, present: p.alreadyPresent, noEmail: p.skippedNoEmail } }}</p>
                @if (p.imported > 0) {
                    <mat-checkbox [(ngModel)]="sendWelcome" [disabled]="running()">
                        {{ 'admin.users.import_send_welcome' | transloco: { count: p.imported } }}
                    </mat-checkbox>
                } @else {
                    <p>{{ 'admin.users.import_nothing' | transloco }}</p>
                }
            } @else if (!error()) {
                <p class="d-flex align-items-center gap-2">
                    <mat-spinner diameter="18"></mat-spinner> {{ 'admin.users.import_counting' | transloco }}
                </p>
            }
            @if (error()) {
                <p class="text-danger">{{ 'admin.users.import_failed' | transloco: { error: error() } }}</p>
            }
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-stroked-button (click)="close()" [disabled]="running()">{{ 'common.actions.cancel' | transloco }}</button>
            <button mat-flat-button color="primary" (click)="runImport()"
                [disabled]="running() || !preview() || preview()!.imported === 0">
                @if (running()) {
                    {{ 'admin.users.import_running' | transloco }}
                } @else {
                    {{ 'admin.users.import_confirm' | transloco: { count: preview()?.imported ?? 0 } }}
                }
            </button>
        </mat-dialog-actions>
    `,
})
export class ImportAppUsersDialogComponent implements OnInit {
    private readonly functions = inject(Functions);
    private readonly dialogRef = inject(MatDialogRef<ImportAppUsersDialogComponent, ImportAppUsersResult>);

    readonly preview = signal<ImportAppUsersResult | null>(null);
    readonly running = signal(false);
    readonly error = signal('');
    sendWelcome = false;

    private call(data: { dryRun: boolean; sendWelcome: boolean }) {
        return arcCallable<typeof data, ImportAppUsersResult>(this.functions, 'importAppUsers', { timeout: 540_000 })(data);
    }

    async ngOnInit(): Promise<void> {
        try {
            this.preview.set((await this.call({ dryRun: true, sendWelcome: false })).data);
        } catch (err) {
            this.error.set(err instanceof Error ? err.message : String(err));
        }
    }

    async runImport(): Promise<void> {
        this.running.set(true);
        this.error.set('');
        try {
            const result = (await this.call({ dryRun: false, sendWelcome: this.sendWelcome })).data;
            this.dialogRef.close(result);
        } catch (err) {
            this.error.set(err instanceof Error ? err.message : String(err));
            this.running.set(false);
        }
    }

    close(): void {
        this.dialogRef.close();
    }
}
