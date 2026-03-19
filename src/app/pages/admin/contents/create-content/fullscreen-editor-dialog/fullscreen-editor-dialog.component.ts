import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import TiptapEditorComponent from '../../../../../../shared/components/tiptap-editor/tiptap-editor.component';

export interface FullscreenEditorData {
    content: string;
    fieldLabel: string;
}

@Component({
    selector: 'arc-fullscreen-editor-dialog',
    standalone: true,
    imports: [CommonModule, TiptapEditorComponent],
    template: `
        <div class="fullscreen-editor-container">
            <div class="fullscreen-editor-header">
                <h5 class="mb-0">{{ data.fieldLabel }}</h5>
                <div class="d-flex gap-2">
                    <button type="button" class="btn btn-primary btn-sm" (click)="save()">
                        <i class="fa-solid fa-check me-1"></i> Done
                    </button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" (click)="cancel()">
                        <i class="fa-solid fa-xmark me-1"></i> Cancel
                    </button>
                </div>
            </div>
            <div class="fullscreen-editor-body">
                <app-tiptap-editor
                    [productValue]="currentContent"
                    (textEditorContent)="onContentChange($event)">
                </app-tiptap-editor>
            </div>
        </div>
    `,
    styles: [`
        .fullscreen-editor-container {
            display: flex;
            flex-direction: column;
            height: 100%;
        }
        .fullscreen-editor-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem 1rem;
            border-bottom: 1px solid #e9ecef;
        }
        .fullscreen-editor-body {
            flex: 1;
            overflow-y: auto;
            padding: 1rem;
        }
        .fullscreen-editor-body app-tiptap-editor {
            display: block;
            width: 100%;
            min-height: 100%;
        }
    `]
})
export class FullscreenEditorDialogComponent {
    currentContent: string;

    constructor(
        public dialogRef: MatDialogRef<FullscreenEditorDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: FullscreenEditorData
    ) {
        this.currentContent = data.content;
    }

    onContentChange(html: string): void {
        this.currentContent = html;
    }

    save(): void {
        this.dialogRef.close(this.currentContent);
    }

    cancel(): void {
        this.dialogRef.close(null);
    }
}
