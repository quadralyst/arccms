import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import { CodeInputComponent } from '../../../shared/components/code-input/code-input.component';
import { readSignInError } from '../../pages/(auth)/sign-in.service';
import { FreshCodeService, type FreshCodeSent } from './fresh-code.service';

export interface FreshCodeDialogData {
    purpose: string;
}

/** Seconds between codes, as the server's resend gap. */
const RESEND_GAP = 60;

/**
 * Arc CMS's fresh-code dialog (FreshCodeService.confirm, docs/app/fresh-code.html):
 * sends the code as it opens, takes the 6 digits, and closes with the proof, or with
 * nothing when cancelled. The same code boxes, test-mode code and resend wait as the
 * sign-in page's code screen.
 */
@Component({
    selector: 'arc-fresh-code-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatDialogTitle, MatDialogContent, MatDialogActions, TranslocoPipe, CodeInputComponent],
    template: `
        <h2 mat-dialog-title>{{ 'member.fresh_code.title' | transloco }}</h2>
        <mat-dialog-content>
            @if (sent(); as s) {
                <p class="fresh-code-to">{{ 'member.auth.code_sent_to' | transloco: { value: s.to } }}</p>
            } @else if (!error()) {
                <p class="fresh-code-to">{{ 'member.auth.sending_code' | transloco }}</p>
            }
            <arc-code-input #boxes [label]="'member.auth.code_label' | transloco" [disabled]="working() || !sent()"
                [invalid]="!!error()" (completed)="check($event)"></arc-code-input>
            @if (sent()?.testCode; as code) {
                <button type="button" class="test-code" (click)="boxes.fill(code)" [disabled]="working()">
                    <span>{{ (sent()?.via === 'email' ? 'member.auth.test_code_label_email' : 'member.auth.test_code_label') | transloco }}</span>
                    <strong>{{ code }}</strong>
                </button>
            } @else if (sent()?.testCodeInLogs) {
                <p class="test-code-note">{{ (sent()?.via === 'email' ? 'member.auth.test_code_in_email_logs' : 'member.auth.test_code_in_logs') | transloco }}</p>
            }
            @if (error()) {
                <div class="alert alert-danger fresh-code-error" role="alert">{{ error() }}</div>
            }
            <div class="fresh-code-resend">
                @if (wait() > 0) {
                    <span>{{ 'member.auth.resend_in' | transloco: { value: wait() } }}</span>
                } @else {
                    <button type="button" class="btn btn-link btn-sm" (click)="send()" [disabled]="working()">{{ 'member.auth.resend' | transloco }}</button>
                }
            </div>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-stroked-button type="button" (click)="cancel()">{{ 'member.fresh_code.cancel' | transloco }}</button>
        </mat-dialog-actions>
    `,
    styles: [`
        .fresh-code-to { margin: 0 0 16px; }
        .test-code { display: flex; gap: 8px; align-items: baseline; margin: 12px auto 0; border: 1px dashed #adb5bd; border-radius: 8px; background: #f8f9fa; padding: 6px 12px; }
        .test-code-note { margin: 12px 0 0; font-size: 0.875rem; color: #6c757d; text-align: center; }
        .fresh-code-error { margin: 12px 0 0; }
        .fresh-code-resend { margin-top: 12px; text-align: center; font-size: 0.875rem; color: #6c757d; min-height: 31px; }
    `],
})
export class FreshCodeDialogComponent {
    private readonly data = inject<FreshCodeDialogData>(MAT_DIALOG_DATA);
    private readonly ref = inject(MatDialogRef<FreshCodeDialogComponent, string | null>);
    private readonly codes = inject(FreshCodeService);
    private readonly boxes = viewChild<CodeInputComponent>('boxes');

    readonly sent = signal<FreshCodeSent | null>(null);
    readonly working = signal(false);
    readonly error = signal('');
    readonly wait = signal(0);
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor() {
        inject(DestroyRef).onDestroy(() => clearInterval(this.timer));
        void this.send();
    }

    async send(): Promise<void> {
        this.working.set(true);
        this.error.set('');
        try {
            const reply = await this.codes.request(this.data.purpose);
            this.sent.set(reply);
            this.countDown(reply.wait ?? RESEND_GAP);
            this.boxes()?.reset();
        } catch (err) {
            const e = readSignInError(err);
            this.error.set(e.message);
            const wait = Number(e.details?.['wait'] ?? 0);
            if (wait > 0) this.countDown(wait);
        } finally {
            this.working.set(false);
        }
    }

    async check(code: string): Promise<void> {
        if (this.working()) return;
        this.working.set(true);
        this.error.set('');
        try {
            const proof = await this.codes.confirmCode(this.data.purpose, code);
            this.ref.close(proof);
        } catch (err) {
            this.error.set(readSignInError(err).message);
            this.working.set(false);
            this.boxes()?.reset();
        }
    }

    cancel(): void {
        this.ref.close(null);
    }

    private countDown(seconds: number): void {
        clearInterval(this.timer);
        this.wait.set(seconds);
        this.timer = setInterval(() => {
            this.wait.update((w) => Math.max(0, w - 1));
            if (this.wait() === 0) clearInterval(this.timer);
        }, 1000);
    }
}
