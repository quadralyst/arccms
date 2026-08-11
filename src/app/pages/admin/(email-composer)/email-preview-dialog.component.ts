import { Component, Inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

export interface EmailPreviewData {
    title: string;
    subject?: string;
    html?: string;
}

@Component({
    standalone: true,
    imports: [MatButtonModule, MatIconModule, MatDialogModule],
    template: `
        <div class="d-flex justify-content-between align-items-center p-3 border-bottom">
            <div>
                <h5 class="mb-0">{{ data.title }}</h5>
                @if (data.subject) {
                <small class="text-muted">{{ data.subject }}</small>
                }
            </div>
            <button mat-icon-button mat-dialog-close aria-label="Close preview">
                <mat-icon>close</mat-icon>
            </button>
        </div>
        <div mat-dialog-content class="p-0" style="max-height: 70vh;">
            @if (data.html) {
            <iframe [srcdoc]="data.html" title="Email preview"
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
    constructor(
        public dialogRef: MatDialogRef<EmailPreviewDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: EmailPreviewData,
    ) {}
}
