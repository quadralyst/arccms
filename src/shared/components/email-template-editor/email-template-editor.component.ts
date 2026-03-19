/**
 * Email Template Editor Component
 * 
 * Reusable WYSIWYG email template editor with:
 * - TipTap rich text editing
 * - Placeholder chip insertion (for subject and body)
 * - HTML view toggle
 * - Form controls for sender config
 */

import { CommonModule } from '@angular/common';
import {
    Component,
    EventEmitter,
    Input,
    Output,
    signal,
    ViewChild,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import TiptapEditorComponent from '../tiptap-editor/tiptap-editor.component';
import { HtmlCodeEditorComponent } from '../html-code-editor/html-code-editor.component';

@Component({
    selector: 'arc-email-template-editor',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ReactiveFormsModule,
        MatChipsModule,
        MatFormFieldModule,
        MatInputModule,
        MatTabsModule,
        TiptapEditorComponent,
        HtmlCodeEditorComponent,
    ],
    templateUrl: './email-template-editor.component.html',
    styleUrls: ['./email-template-editor.component.scss'],
})
export class EmailTemplateEditorComponent {
    @Input() placeholders: string[] = [];
    @Input() label: string = 'Template Content';
    @Input() showHtmlToggle: boolean = true;
    @Input() set value(val: string) {
        if (val !== this.htmlContent) {
            this.htmlContent = val || '';
            this.formattedHtmlContent = this.formatHtml(this.htmlContent);
        }
    }
    @Output() contentChange = new EventEmitter<string>();

    // ViewChild references to editors
    @ViewChild(TiptapEditorComponent) tiptapEditor?: TiptapEditorComponent;
    @ViewChild(HtmlCodeEditorComponent) htmlCodeEditor?: HtmlCodeEditorComponent;

    // Template content
    htmlContent: string = '';
    formattedHtmlContent: string = '';

    // Tabs
    activeTab = signal<'editor' | 'html'>('editor');

    setActiveTab(tab: 'editor' | 'html'): void {
        this.activeTab.set(tab);
        if (tab === 'html') {
            this.formattedHtmlContent = this.formatHtml(this.htmlContent);
        }
    }

    onEditorChanges(content: string): void {
        this.htmlContent = content;
        this.contentChange.emit(content);
    }

    onHtmlChanges(content: string): void {
        this.htmlContent = content;
        this.formattedHtmlContent = content;
        this.contentChange.emit(content);
    }

    insertPlaceholder(placeholder: string): void {
        if (this.activeTab() === 'html') {
            // Insert at cursor position in HTML code editor
            if (this.htmlCodeEditor) {
                this.htmlCodeEditor.insertTextAtCursor(placeholder);
            }
        } else {
            // Insert at cursor position in TipTap editor
            if (this.tiptapEditor) {
                this.tiptapEditor.insertTextAtCursor(placeholder);
            }
        }
    }

    private formatHtml(html: string): string {
        // Basic HTML formatting
        return html
            .replace(/></g, '>\n<')
            .replace(/\n\s*\n/g, '\n');
    }

    // Handle Tab key in HTML textarea
    handleKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Tab') {
            event.preventDefault();
            const textarea = event.target as HTMLTextAreaElement;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const value = textarea.value;

            textarea.value = value.substring(0, start) + '  ' + value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 2;
        }
    }
}
