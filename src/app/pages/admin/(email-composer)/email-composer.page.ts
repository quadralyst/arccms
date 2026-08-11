import { RouteMeta } from '@analogjs/router';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, inject, Injector, OnInit, PLATFORM_ID, runInInjectionContext, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
    Firestore, collection, collectionData, doc, addDoc, updateDoc, serverTimestamp, query, orderBy,
} from '@angular/fire/firestore';
import { catchError, of } from 'rxjs';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { BrandKitService } from '../(email-brand)/brand-kit.service';
import { EmailBlockEditorComponent, BlockEditorSaveEvent } from '../../../../shared/components/email-block-editor/email-block-editor.component';
import { TestSendDialogComponent } from '../../../../shared/components/test-send-dialog/test-send-dialog.component';
import { EmailDesign, IEmailBrandKit, DEFAULT_BRAND_KIT } from '../../../../shared/email-compiler/email-design.model';
import { buildNewEmailTemplate } from '../../../../shared/email-compiler/new-template';
import { dedupeTemplatesByType } from '../../../../shared/utils/template-dedupe';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { EmailPreviewDialogComponent } from './email-preview-dialog.component';
import { getComposerTags } from '../../../../shared/constants/email-tags';

export const routeMeta: RouteMeta = {
    title: 'Email Composer | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

interface TemplateDoc {
    id: string;
    type: string;
    title?: string;
    subject?: string;
    category?: 'transactional' | 'marketing';
    template?: string;
    design?: EmailDesign;
    editorVersion?: 'html' | 'blocks';
}

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule,
        MatFormFieldModule, MatInputModule, MatSelectModule,
        MatDialogModule, EmailBlockEditorComponent,
        GlobalTableComponent, PageHeaderComponent,
    ],
    templateUrl: './email-composer.page.html',
})
export default class EmailComposerPageComponent implements OnInit {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private brandKitService = inject(BrandKitService);
    private toast = inject(ToastService);
    private platformId = inject(PLATFORM_ID);
    private dialog = inject(MatDialog);
    private injector = inject(Injector);

    templates = signal<TemplateDoc[]>([]);
    selectedId = signal<string>('');
    brandKit = signal<IEmailBrandKit>({ ...DEFAULT_BRAND_KIT });

    selected = signal<TemplateDoc | null>(null);
    /** True once a legacy (html) template has been upgraded to a starter block design. */
    upgraded = signal(false);

    /** Editable metadata for the selected template (title/subject/category live at the doc level, not in the block design). */
    titleDraft = signal('');
    subjectDraft = signal('');
    categoryDraft = signal<'transactional' | 'marketing'>('transactional');
    creating = signal(false);

    loading = signal(true);
    tableColumns: TableColumn[] = this.buildColumns();

    ngOnInit(): void {
        this.brandKitService.getBrandKit().subscribe((k) => this.brandKit.set(k));
        // Admin-only Firestore rules; SSR has no authenticated user, so skip
        // the doomed request instead of letting it fail with permission-denied.
        if (!isPlatformBrowser(this.platformId)) {
            this.loading.set(false);
            return;
        }
        runInInjectionContext(this.injector, () => {
            const ref = collection(this.firestore, 'EmailTemplate');
            collectionData(query(ref, orderBy('type')), { idField: 'id' }).pipe(
                catchError((err) => {
                    console.error('Error fetching email templates:', err);
                    return of([]);
                }),
            ).subscribe((docs) => {
                this.templates.set(dedupeTemplatesByType(docs as TemplateDoc[]));
                this.loading.set(false);
            });
        });
    }

    private buildColumns(): TableColumn[] {
        return [
            { key: 'index', header: '#', type: 'index' },
            {
                key: 'title',
                header: 'Template',
                clickable: true,
                classFn: () => 'fw-bold cursor-pointer text-primary',
                transformFn: (row: TemplateDoc) => row.title || row.type,
            },
            {
                key: 'type',
                header: 'Type',
                type: 'text',
                transformFn: (row: TemplateDoc) =>
                    (row.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            },
            {
                key: 'subject',
                header: 'Subject',
                type: 'text',
                transformFn: (row: TemplateDoc) => row.subject || '(no subject)',
            },
            {
                key: 'category',
                header: 'Category',
                type: 'text',
                transformFn: (row: TemplateDoc) => row.category || 'transactional',
            },
            {
                key: 'editorVersion',
                header: 'Editor',
                type: 'badge',
                badgeConfig: { trueText: 'Blocks', falseText: 'HTML' },
                transformFn: (row: TemplateDoc) => row.editorVersion === 'blocks',
            },
            {
                key: 'actions',
                header: '',
                type: 'actions',
                actions: [
                    {
                        action: 'edit',
                        icon: 'fas fa-pen text-secondary',
                        label: 'Edit',
                        class: 'edit',
                        isRowClick: true,
                        onAction: (row: TemplateDoc) => this.onSelect(row.id),
                    },
                    {
                        action: 'preview',
                        icon: 'fas fa-eye text-secondary',
                        label: 'Preview',
                        class: 'view',
                        onAction: (row: TemplateDoc) => this.onPreview(row),
                    },
                ],
            },
        ];
    }

    onCellClick(event: { key: string; row: TemplateDoc }): void {
        if (event.key === 'title') {
            this.onSelect(event.row.id);
        }
    }

    onPreview(row: TemplateDoc): void {
        this.dialog.open(EmailPreviewDialogComponent, {
            width: '820px',
            data: { title: row.title || row.type, subject: row.subject, html: row.template },
        });
    }

    clearSelection(): void {
        this.selectedId.set('');
        this.selected.set(null);
        this.upgraded.set(false);
    }

    private syncDrafts(t: TemplateDoc | null): void {
        this.titleDraft.set(t?.title || '');
        this.subjectDraft.set(t?.subject || '');
        this.categoryDraft.set(t?.category || 'transactional');
    }

    /**
     * Create a brand-new email template and open it in the block editor.
     * Writes a starter `EmailTemplate` doc up front (the block editor saves via
     * `updateDoc`, which needs the doc to already exist) so the new email is
     * immediately editable here and selectable as a drip step.
     */
    async createNew(): Promise<void> {
        if (this.creating()) return;
        this.creating.set(true);
        try {
            const payload = buildNewEmailTemplate(
                { title: 'Untitled email', subject: '', category: 'marketing' },
                Date.now(),
                this.brandKit(),
            );
            const ref = await runInInjectionContext(this.injector, () =>
                addDoc(collection(this.firestore, 'EmailTemplate'), {
                    ...payload,
                    createdAt: serverTimestamp(),
                    modifiedAt: serverTimestamp(),
                    modifiedBy: 'admin',
                }),
            );
            const created: TemplateDoc = { id: ref.id, ...payload };
            this.selectedId.set(ref.id);
            this.upgraded.set(false);
            this.selected.set(created);
            this.syncDrafts(created);
            this.toast.success('New email created — edit the details and save');
        } catch (err) {
            console.error(err);
            this.toast.error('Failed to create email');
        } finally {
            this.creating.set(false);
        }
    }

    get isBlocks(): boolean {
        const t = this.selected();
        return !!t && (t.editorVersion === 'blocks' || this.upgraded());
    }

    get currentDesign(): EmailDesign {
        return this.selected()?.design || { blocks: [] };
    }

    onSelect(id: string): void {
        this.selectedId.set(id);
        this.upgraded.set(false);
        const t = this.templates().find((tpl) => tpl.id === id) || null;
        this.selected.set(t);
        this.syncDrafts(t);
    }

    /** Legacy templates open read-only; upgrading starts a blank block design (no lossy auto-convert). */
    upgradeToBlocks(): void {
        const t = this.selected();
        if (!t) return;
        this.selected.set({
            ...t,
            design: {
                blocks: [
                    { id: 'h', type: 'heading', text: t.title || 'Heading', level: 1 },
                    { id: 'p', type: 'paragraph', html: 'Start writing your email…' },
                ],
            },
        });
        this.upgraded.set(true);
        this.toast.success('Started a block version — edit and save to switch this template to blocks.');
    }

    async onSaved(e: BlockEditorSaveEvent): Promise<void> {
        const t = this.selected();
        if (!t) return;
        const title = this.titleDraft().trim() || 'Untitled email';
        const subject = this.subjectDraft().trim();
        const category = this.categoryDraft();
        try {
            await updateDoc(doc(this.firestore, 'EmailTemplate', t.id), {
                title,
                subject,
                category,
                design: e.design as any,
                template: e.html,
                editorVersion: 'blocks',
                modifiedAt: serverTimestamp(),
                modifiedBy: 'admin',
            });
            this.selected.set({ ...t, title, subject, category, design: e.design, template: e.html, editorVersion: 'blocks' });
            this.upgraded.set(false);
            this.toast.success('Template saved (design + compiled HTML)');
        } catch (err) {
            console.error(err);
            this.toast.error('Failed to save template');
        }
    }

    async onTestSend(e: BlockEditorSaveEvent): Promise<void> {
        const subject = this.subjectDraft().trim() || this.selected()?.subject || 'Test';
        const to = await firstValueFrom(
            this.dialog.open(TestSendDialogComponent, { width: '420px', data: { subject } }).afterClosed(),
        );
        if (!to) return;
        try {
            const callable = httpsCallable(this.functions, 'sendTestEmail');
            await callable({ toEmail: to, subject, html: e.html });
            this.toast.success('Test email queued');
        } catch (err) {
            console.error(err);
            this.toast.error('Failed to send test');
        }
    }

    /** Placeholder palette per template type — sourced from the central registry. */
    placeholdersFor(type?: string): string[] {
        return getComposerTags(type);
    }
}
