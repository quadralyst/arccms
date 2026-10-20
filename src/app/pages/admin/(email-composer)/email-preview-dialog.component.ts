import { Component, Inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

export interface EmailPreviewData {
    title: string;
    subject?: string;
    html?: string;
    /** The template in each of its languages; the preview offers a choice when there are several. */
    languages?: Array<{ code: string; subject: string; html: string }>;
    /** A line above the preview, such as where an app template's words are changed. */
    note?: string;
}

@Component({
    standalone: true,
    imports: [MatButtonModule, MatIconModule, MatDialogModule],
    template: `
        <div class="d-flex justify-content-between align-items-center p-3 border-bottom">
            <div>
                <h5 class="mb-0">{{ data.title }}</h5>
                @if (subject()) {
                <small class="text-muted">{{ subject() }}</small>
                }
            </div>
            @if ((data.languages?.length ?? 0) > 1) {
            <div class="btn-group btn-group-sm ms-auto me-2" role="group" aria-label="Language">
                @for (l of data.languages; track l.code; let i = $index) {
                <button type="button" class="btn" [class.btn-primary]="i === chosen()" [class.btn-outline-secondary]="i !== chosen()"
                    [attr.aria-pressed]="i === chosen()" (click)="chosen.set(i)">{{ l.code }}</button>
                }
            </div>
            }
            <button mat-icon-button mat-dialog-close aria-label="Close preview">
                <mat-icon>close</mat-icon>
            </button>
        </div>
        @if (data.note) {
        <div class="alert alert-info small m-3 mb-0">{{ data.note }}</div>
        }
        <div mat-dialog-content class="p-0" style="max-height: 70vh;">
            @if (html()) {
            <iframe [srcdoc]="html()" sandbox="" title="Email preview"
                style="width: 100%; height: 70vh; border: 0;"></iframe>
            } @else {
            <div class="alert alert-info m-3">
                This template has no compiled HTML yet. Open it in the editor and save to generate a preview.
            </div>
            }
        </div>
    `,
})
export class EmailPreviewDialogComponent {
    /** The language shown, by its place in `languages`. */
    readonly chosen = signal(0);

    subject(): string {
        return this.data.languages?.[this.chosen()]?.subject ?? this.data.subject ?? '';
    }

    html(): string {
        return this.data.languages?.[this.chosen()]?.html ?? this.data.html ?? '';
    }

    constructor(
        public dialogRef: MatDialogRef<EmailPreviewDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: EmailPreviewData,
    ) {}
}
