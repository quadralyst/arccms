import { RouteMeta } from '@analogjs/router';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, inject, Injector, OnInit, PLATFORM_ID, runInInjectionContext, signal } from '@angular/core';
import {
    Firestore, collection, collectionData, doc, updateDoc, serverTimestamp, query, orderBy,
} from '@angular/fire/firestore';
import { catchError, of } from 'rxjs';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { BrandKitService } from '../(email-brand)/brand-kit.service';
import { EmailBlockEditorComponent, BlockEditorSaveEvent } from '../../../../shared/components/email-block-editor/email-block-editor.component';
import { TestSendDialogComponent } from '../../../../shared/components/test-send-dialog/test-send-dialog.component';
import { EmailDesign, IEmailBrandKit, DEFAULT_BRAND_KIT } from '../../../../shared/email-compiler/email-design.model';
import { dedupeTemplatesByType } from '../../../../shared/utils/template-dedupe';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { EmailPreviewDialogComponent } from './email-preview-dialog.component';

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
        CommonModule, MatButtonModule, MatIconModule,
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
        this.selected.set(this.templates().find((t) => t.id === id) || null);
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
        try {
            await updateDoc(doc(this.firestore, 'EmailTemplate', t.id), {
                design: e.design as any,
                template: e.html,
                editorVersion: 'blocks',
                modifiedAt: serverTimestamp(),
                modifiedBy: 'admin',
            });
            this.selected.set({ ...t, design: e.design, template: e.html, editorVersion: 'blocks' });
            this.upgraded.set(false);
            this.toast.success('Template saved (design + compiled HTML)');
        } catch (err) {
            console.error(err);
            this.toast.error('Failed to save template');
        }
    }

    async onTestSend(e: BlockEditorSaveEvent): Promise<void> {
        const subject = this.selected()?.subject || 'Test';
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

    /** Placeholder palette per template type — reuse simple common tags. */
    placeholdersFor(type?: string): string[] {
        const common = ['##NAME##', '##EMAIL##', '##COMPANY_NAME##', '##UNSUBSCRIBE_LINK##', '##PREFERENCES_LINK##'];
        if (type?.includes('otp')) return [...common, '##OTP##'];
        if (type?.includes('payment')) return [...common, '##PAYMENT_AMOUNT##', '##SUBSCRIPTION_PLAN##', '##RENEWAL_DATE##'];
        return common;
    }
}
