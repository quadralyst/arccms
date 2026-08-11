/**
 * Broadcast Email Editor Component
 * 
 * Full-featured email editor for creating and sending broadcast emails to waitlist users.
 * Integrates with TipTap editor for rich content editing.
 */

import { CommonModule } from '@angular/common';
import {
    Component,
    EventEmitter,
    inject,
    Input,
    Output,
    signal,
    ViewChild,
} from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule, MatSelectionList, MatSelectionListChange } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { DomSanitizer } from '@angular/platform-browser';
import TiptapEditorComponent from '../tiptap-editor/tiptap-editor.component';
import { HtmlCodeEditorComponent } from '../html-code-editor/html-code-editor.component';
import { ConstantVariables } from '../../constants/common-constants';
import { GlobalService } from '../../services/global.service';
import { ToastService } from '../../services/toast.service';
import { SendBroadcastEmailComponent } from './send-broadcast-email/send-broadcast-email.component';
import { IBroadcastRecipient } from './send-broadcast-email/send-broadcast-email.model';
import { TestEmailComponent } from '../test-email/test-email.component';
import { EmailSettingService } from '../../../app/pages/admin/(settings)/email-setting/email-setting.service';
import { HashtagAutocompleteDirective } from '../../directives/hashtag-autocomplete/hashtag-autocomplete.directive';
import { getEmailTags } from '../../constants/email-tags';

type SendToOption = 'all' | 'some' | 'new' | '';

@Component({
    selector: 'arc-broadcast-email-editor',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ReactiveFormsModule,
        MatIconModule,
        MatFormFieldModule,
        MatInputModule,
        MatChipsModule,
        MatTabsModule,
        MatListModule,
        MatDialogModule,
        TiptapEditorComponent,
        HtmlCodeEditorComponent,
        HashtagAutocompleteDirective,
    ],
    templateUrl: './broadcast-email-editor.component.html',
    styleUrls: ['./broadcast-email-editor.component.scss'],
})
export class BroadcastEmailEditorComponent {
    @Input() allUsers: any[] = [];
    @Input() waitlistId: string = '';
    @Output() close = new EventEmitter<void>();
    @Output() broadcastSent = new EventEmitter<void>();

    @ViewChild('userList') userSelectionList!: MatSelectionList;
    @ViewChild(TiptapEditorComponent) tiptapEditor!: TiptapEditorComponent;

    private readonly fb = inject(FormBuilder);
    private readonly dialog = inject(MatDialog);
    private readonly sanitizer = inject(DomSanitizer);
    private readonly globalService = inject(GlobalService);
    private readonly toastService = inject(ToastService);
    private readonly emailSettingService = inject(EmailSettingService);

    readonly constantVariables = new ConstantVariables();

    // Form
    broadcastForm!: FormGroup;
    errorMessages: string[] = [];

    // Editor state
    activeTab = signal<'editor' | 'html'>('editor');
    htmlContent = '';
    formattedHtmlContent = '';

    // User selection
    selectedUsers: IBroadcastRecipient[] = [];
    sendToValue = signal<SendToOption>('');
    showEmailInput = signal(false);

    // Broadcast email placeholders / merge tags
    readonly emailPlaceholders = getEmailTags('broadcast');

    ngOnInit(): void {
        this.initForm();
        this.setupFormListeners();
        this.loadEmailSettings();
    }

    private initForm(): void {
        this.broadcastForm = this.fb.group({
            sendTo: ['', Validators.required],
            senderName: ['Arc CMS', Validators.required],
            senderEmail: ['noreply@arccms.com', [Validators.required, this.globalService.emailValidator()]],
            subject: ['', Validators.required],
            previewText: [''],
            emails: [''],
        });
    }

    private setupFormListeners(): void {
        this.broadcastForm.valueChanges.subscribe(() => {
            this.errorMessages = [];
        });

        this.broadcastForm.get('sendTo')?.valueChanges.subscribe((value: SendToOption) => {
            this.sendToValue.set(value);
            this.showEmailInput.set(value === 'new');

            if (value !== 'new') {
                this.broadcastForm.get('emails')?.reset();
            }
        });
    }

    private loadEmailSettings(): void {
        this.emailSettingService.getEmailSettings().subscribe({
            next: (settings) => {
                this.broadcastForm.patchValue({
                    senderName: settings.senderName,
                    senderEmail: settings.senderEmail,
                });
            },
            error: (error) => {
                console.error('Failed to load email settings:', error);
            },
        });
    }

    // Form getters
    get senderName() { return this.broadcastForm.get('senderName'); }
    get senderEmail() { return this.broadcastForm.get('senderEmail'); }
    get subject() { return this.broadcastForm.get('subject'); }
    get previewText() { return this.broadcastForm.get('previewText'); }
    get emails() { return this.broadcastForm.get('emails'); }

    // Tab switching
    setActiveTab(tab: 'editor' | 'html'): void {
        this.activeTab.set(tab);
        if (tab === 'html') {
            this.formattedHtmlContent = this.formatHtmlContent(this.htmlContent);
        }
    }

    // Editor content handling
    onEditorChanges(content: string): void {
        if (this.activeTab() === 'editor') {
            this.htmlContent = content;
            this.formattedHtmlContent = this.formatHtmlContent(content);
        } else {
            this.htmlContent = this.processContent(content);
        }
    }

    private processContent(content: string): string {
        return content
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&');
    }

    private formatHtmlContent(content: string): string {
        if (!content || typeof content !== 'string') {
            return '';
        }

        try {
            const tokens = content.split(/(<\/?[^>]+>)/g);
            let formatted = '';
            let indent = 0;
            const indentSize = 2;
            const selfClosingTags = ['input', 'img', 'br', 'hr', 'meta', 'link'];

            tokens.forEach((token) => {
                if (!token.trim()) return;

                if (token.startsWith('</')) {
                    indent = Math.max(0, indent - indentSize);
                    formatted += ' '.repeat(indent) + token + '\n';
                } else if (token.startsWith('<')) {
                    const isSelfClosing =
                        token.endsWith('/>') ||
                        selfClosingTags.some((tag) => token.toLowerCase().startsWith('<' + tag));

                    formatted += ' '.repeat(indent) + token + '\n';

                    if (!isSelfClosing) {
                        indent += indentSize;
                    }
                } else {
                    formatted += ' '.repeat(indent) + token.trim() + '\n';
                }
            });

            return formatted;
        } catch {
            return content;
        }
    }

    // Insert placeholder into editor
    insertPlaceholder(placeholder: string): void {
        if (this.activeTab() === 'editor' && this.tiptapEditor?.editor) {
            this.tiptapEditor.editor.commands.insertContent(placeholder);
        } else {
            // Insert at cursor position in HTML textarea
            const textarea = document.querySelector('.html-textarea') as HTMLTextAreaElement;
            if (textarea) {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                this.formattedHtmlContent =
                    this.formattedHtmlContent.substring(0, start) +
                    placeholder +
                    this.formattedHtmlContent.substring(end);
            }
        }
    }

    // User selection handling
    onSelectChange(event: Event): void {
        const selectValue = (event.target as HTMLSelectElement).value as SendToOption;
        this.sendToValue.set(selectValue);

        switch (selectValue) {
            case 'all':
                this.selectedUsers = this.allUsers.map((user: any) => ({
                    toName: user.name,
                    toEmail: user.email,
                    createdAt: new Date(),
                    trackId: Math.floor(1000 + Math.random() * 9000),
                }));
                if (this.userSelectionList) {
                    this.userSelectionList.selectAll();
                }
                break;

            case 'some':
            case 'new':
                this.selectedUsers = [];
                if (this.userSelectionList) {
                    this.userSelectionList.deselectAll();
                }
                break;

            default:
                this.selectedUsers = [];
                if (this.userSelectionList) {
                    this.userSelectionList.deselectAll();
                }
                break;
        }
    }

    onSelectionChange(event: MatSelectionListChange): void {
        const selectedOptions = this.userSelectionList.selectedOptions.selected;

        this.selectedUsers = selectedOptions.map((option) => ({
            toName: option.value.name,
            toEmail: option.value.email,
            createdAt: new Date(),
            trackId: Math.floor(1000 + Math.random() * 9000),
        }));

        // Update dropdown if selection changed from "all"
        if (this.sendToValue() === 'all' && selectedOptions.length < this.allUsers.length) {
            this.broadcastForm.get('sendTo')?.setValue('some', { emitEvent: false });
            this.sendToValue.set('some');
        }
    }

    // Form submission
    onSubmit(): void {
        if (this.broadcastForm.invalid) {
            this.errorMessages = this.getFormErrors();
            return;
        }
    }

    submitBroadcastEmail(): void {
        if (this.sendToValue() === 'new') {
            this.processNewEmails();
        } else {
            this.selectedUsers = this.selectedUsers.map((user) => ({
                ...user,
                ...this.broadcastForm.value,
            }));
            this.openSendBroadcastModal();
        }
    }

    private processNewEmails(): void {
        const emailValues = this.broadcastForm.get('emails')?.value;

        if (!emailValues) return;

        const userEntries = emailValues
            .split('\n')
            .map((entry: string) => entry.trim())
            .filter((entry: string) => entry);

        this.selectedUsers = userEntries.map((entry: string) => {
            const [name, email] = entry.split(',').map((item) => item.trim());
            const tempName = email?.split('@')[0] || '';

            return {
                ...this.broadcastForm.value,
                toName: name || (tempName.charAt(0).toUpperCase() + tempName.slice(1)) || '',
                toEmail: email,
                createdAt: new Date(),
                trackId: Math.floor(1000 + Math.random() * 9000),
            };
        });

        if (this.selectedUsers.length > 0) {
            this.openSendBroadcastModal();
        }
    }

    private openSendBroadcastModal(): void {
        const selectedUsersWithTemplate = this.selectedUsers.map((user) => ({
            ...user,
            template: this.htmlContent,
        }));

        const dialogRef = this.dialog.open(SendBroadcastEmailComponent, {
            enterAnimationDuration: '300ms',
            exitAnimationDuration: '200ms',
            width: '90vw',
            maxWidth: '1200px',
            maxHeight: '90vh',
            panelClass: 'broadcast-email-dialog',
            disableClose: true,
            data: {
                formValue: this.broadcastForm.value,
                contentTemplate: this.htmlContent,
                selectedUsers: selectedUsersWithTemplate,
                waitlistId: this.waitlistId,
            },
        });

        dialogRef.afterClosed().subscribe((result: any) => {
            if (result?.success) {
                this.toastService.success('Broadcast email sent successfully!');
                this.broadcastSent.emit();
                this.closeModal();
            }
        });
    }

    private getFormErrors(): string[] {
        const errors: string[] = [];
        const controls = this.broadcastForm.controls;

        for (const name in controls) {
            if (controls[name].invalid) {
                const friendlyName = name.replace(/([A-Z])/g, ' $1').trim();
                errors.push(`${friendlyName.charAt(0).toUpperCase() + friendlyName.slice(1)} is required`);
            }
        }

        return errors;
    }

    closeModal(): void {
        this.close.emit();
    }

    // Validate if form can be submitted
    canSubmit(): boolean {
        if (!this.broadcastForm.valid) return false;
        if (!this.htmlContent) return false;

        const sendTo = this.sendToValue();
        if (sendTo === 'new') {
            return !!this.broadcastForm.get('emails')?.value;
        }

        return this.selectedUsers.length > 0 || sendTo === 'all';
    }

    // Handle keyboard in HTML view
    handleKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Tab') {
            event.preventDefault();
            const textarea = event.target as HTMLTextAreaElement;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;

            textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 2;
        }
    }

    // Open test email dialog
    openTestEmailDialog(): void {
        if (!this.htmlContent) {
            this.toastService.error('Please add email content before sending a test email.');
            return;
        }

        this.dialog.open(TestEmailComponent, {
            enterAnimationDuration: '300ms',
            exitAnimationDuration: '200ms',
            width: '90vw',
            maxWidth: '1000px',
            maxHeight: '90vh',
            panelClass: 'test-email-dialog',
            data: {
                formValue: this.broadcastForm.value,
                contentTemplate: this.htmlContent,
            },
        });
    }
}
