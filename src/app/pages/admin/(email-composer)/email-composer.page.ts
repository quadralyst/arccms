import { RouteMeta } from '@analogjs/router';
import { PreviewLinksDirective } from '../../../../shared/directives/preview-links/preview-links.directive';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, inject, Injector, OnInit, PLATFORM_ID, runInInjectionContext, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
    Firestore, collection, collectionData, doc, addDoc, updateDoc, serverTimestamp, query, orderBy,
} from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom, Subscription } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { injectT } from '../../../core/i18n/inject-t';
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
import { arcCallable } from '../../../core/config/arc-functions';
import { isOn } from '../../../core/features/features';
import type { FeatureId } from '../../../core/features/feature-registry';

/**
 * The feature whose emails a template type is (specs/feature-flags-spec.md). The
 * composer leaves those of a feature that is off out: nothing sends them. Marketing
 * templates stay, since automations can send them without email marketing.
 */
export function templateFeature(type: string): FeatureId | undefined {
    if (type.startsWith('waitlist_')) return 'forms';
    if (type.startsWith('payment_') || ['subscription_lifecycle_email', 'trial_ending_email', 'updates_ending_email'].includes(type)) {
        return 'payments';
    }
    return undefined;
}

/** One language's version of a template, as the template document keeps it. */
interface LanguageVersion {
    subject?: string;
    template?: string;
}

/**
 * A template's languages for the preview (specs/app-email-spec.md): an app
 * template's own, or English (the template itself) and the languages the app
 * added to an account email. Empty for a template in one language.
 */
export function previewLanguages(t: Pick<TemplateDoc, 'owner' | 'subject' | 'template' | 'language' | 'languages'>): Array<{ code: string; subject: string; html: string }> {
    const extra = Object.entries(t.languages ?? {}).map(([code, v]) => ({ code, subject: v.subject ?? '', html: v.template ?? '' }));
    if (!extra.length) return [];
    if (t.owner === 'app') return extra;
    return [{ code: t.language || 'en', subject: t.subject ?? '', html: t.template ?? '' }, ...extra];
}

/** A template's ##TAG## tokens filled with its sample data, for the preview. Values show as text. */
export function fillSample(text: string, sample: Record<string, string> | undefined): string {
    if (!sample) return text;
    const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return text.replace(/##([A-Z_]+)##/g, (whole, tag: string) => (tag in sample ? escape(String(sample[tag])) : whole));
}

export const routeMeta: RouteMeta = {
    title: 'Composer',
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
    /** `app`: a template the app ships (functions/src/custom/email-templates.ts), read-only here. */
    owner?: string;
    /** The language of `subject` and `template`, when the template has several. */
    language?: string;
    /** Its other languages: an app template's, or the app's wording of an account email. */
    languages?: Record<string, LanguageVersion>;
    /** Tag data for an app template's preview. */
    sample?: Record<string, string>;
}

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule,
        MatFormFieldModule, MatInputModule, MatSelectModule,
        MatDialogModule, EmailBlockEditorComponent,
        GlobalTableComponent, PageHeaderComponent, PreviewLinksDirective, TranslocoPipe,
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
    private readonly t = injectT();

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
    /** Set when the templates did not load: the table says so and offers Retry. */
    loadError = signal<string | boolean | null>(null);
    private templatesSub?: Subscription;
    tableColumns: TableColumn[] = this.buildColumns();

    ngOnInit(): void {
        this.brandKitService.getBrandKit().subscribe((k) => this.brandKit.set(k));
        // Admin-only Firestore rules; SSR has no authenticated user, so skip
        // the doomed request instead of letting it fail with permission-denied.
        if (!isPlatformBrowser(this.platformId)) {
            this.loading.set(false);
            return;
        }
        // The app's templates catch up with its file (a new or changed one since the
        // last deploy); the list below follows on its own. Not deployed yet: the list
        // still shows what was there.
        runInInjectionContext(this.injector, () => arcCallable(this.functions, 'syncAppEmailTemplates')({}))
            .catch((err) => console.warn('Could not bring the app\'s templates up to date:', err));
        this.load();
    }

    /** Read the templates (live). Retry calls it again after a failed read. */
    load(): void {
        this.templatesSub?.unsubscribe();
        this.loading.set(true);
        this.loadError.set(null);
        this.templatesSub = runInInjectionContext(this.injector, () => {
            const ref = collection(this.firestore, 'EmailTemplate');
            return collectionData(query(ref, orderBy('type')), { idField: 'id' });
        }).subscribe({
            next: (docs) => {
                this.templates.set(dedupeTemplatesByType(docs as TemplateDoc[]).filter((t) => {
                    const feature = templateFeature(t.type || '');
                    return !feature || isOn(feature);
                }));
                this.loadError.set(null);
                this.loading.set(false);
            },
            error: (err) => {
                console.error('Error fetching email templates:', err);
                this.loadError.set(true);
                this.loading.set(false);
            },
        });
    }

    private buildColumns(): TableColumn[] {
        return [
            { key: 'index', header: '#', type: 'index' },
            {
                key: 'title',
                header: 'admin.email_composer.col_template',
                clickable: true,
                classFn: () => 'fw-bold cursor-pointer text-primary',
                transformFn: (row: TemplateDoc) => row.title || row.type,
            },
            {
                key: 'type',
                header: 'common.table.type',
                type: 'text',
                transformFn: (row: TemplateDoc) => row.owner === 'app'
                    ? this.t('admin.email_composer.app_type', { name: (row.type || '').replace(/^app\./, '') })
                    : (row.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            },
            {
                key: 'languages',
                header: 'admin.email_composer.col_languages',
                type: 'text',
                transformFn: (row: TemplateDoc) => previewLanguages(row).map((l) => l.code).join(', ') || '-',
            },
            {
                key: 'subject',
                header: 'admin.email_composer.subject',
                type: 'text',
                transformFn: (row: TemplateDoc) => row.subject || this.t('admin.email_composer.no_subject'),
            },
            {
                key: 'category',
                header: 'admin.email_composer.category',
                type: 'text',
                transformFn: (row: TemplateDoc) => this.t(row.category === 'marketing' ? 'admin.email_composer.marketing' : 'admin.email_composer.transactional'),
            },
            {
                key: 'editorVersion',
                header: 'admin.email_composer.col_editor',
                type: 'badge',
                badgeConfig: {
                    textFn: (row: TemplateDoc) => this.t(row.editorVersion === 'blocks' ? 'admin.email_composer.blocks' : 'admin.email_composer.html'),
                },
                classFn: (row: TemplateDoc) => (row.editorVersion === 'blocks' ? 'active' : 'inactive'),
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
                        label: 'common.actions.edit',
                        class: 'edit',
                        isRowClick: true,
                        // The app's templates are its code: previewed here, changed in its file.
                        hide: (row: TemplateDoc) => row.owner === 'app',
                        onAction: (row: TemplateDoc) => this.onSelect(row.id),
                    },
                    {
                        action: 'preview',
                        icon: 'fas fa-eye text-secondary',
                        label: 'admin.email_composer.preview',
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
        const fill = (text: string) => fillSample(text, row.sample);
        this.dialog.open(EmailPreviewDialogComponent, {
            width: '820px',
            data: {
                title: row.title || row.type,
                subject: fill(row.subject ?? ''),
                html: fill(row.template ?? ''),
                languages: previewLanguages(row).map((l) => ({ code: l.code, subject: fill(l.subject), html: fill(l.html) })),
                note: row.owner === 'app' ? this.t('admin.email_composer.app_note') : '',
            },
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
                { title: this.t('admin.email_composer.untitled'), subject: '', category: 'marketing' },
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
            this.toast.success(this.t('admin.email_composer.created'));
        } catch (err) {
            console.error(err);
            this.toast.error(this.t('admin.email_composer.create_failed'));
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
        const row = this.templates().find((tpl) => tpl.id === id);
        if (row?.owner === 'app') {
            this.onPreview(row);
            return;
        }
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
                    { id: 'h', type: 'heading', text: t.title || this.t('admin.email_composer.starter_heading'), level: 1 },
                    { id: 'p', type: 'paragraph', html: this.t('admin.email_composer.starter_text') },
                ],
            },
        });
        this.upgraded.set(true);
        this.toast.success(this.t('admin.email_composer.upgraded'));
    }

    async onSaved(e: BlockEditorSaveEvent): Promise<void> {
        const t = this.selected();
        if (!t) return;
        const title = this.titleDraft().trim() || this.t('admin.email_composer.untitled');
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
            this.toast.success(this.t('admin.email_composer.saved'));
        } catch (err) {
            console.error(err);
            this.toast.error(this.t('admin.email_composer.save_failed'));
        }
    }

    async onTestSend(e: BlockEditorSaveEvent): Promise<void> {
        const subject = this.subjectDraft().trim() || this.selected()?.subject || this.t('admin.email_composer.test_subject');
        const to = await firstValueFrom(
            this.dialog.open(TestSendDialogComponent, { width: '420px', data: { subject } }).afterClosed(),
        );
        if (!to) return;
        try {
            const callable = arcCallable(this.functions, 'sendTestEmail');
            await callable({ toEmail: to, subject, html: e.html });
            this.toast.success(this.t('admin.email_composer.test_queued'));
        } catch (err) {
            console.error(err);
            this.toast.error(this.t('admin.email_composer.test_failed'));
        }
    }

    /** Placeholder palette per template type: sourced from the central registry. */
    placeholdersFor(type?: string): string[] {
        return getComposerTags(type);
    }
}
