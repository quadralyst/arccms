import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { statusBadgeClass } from '../../../../shared/utils/status-badge';
import { BroadcastService, BroadcastAudience, BroadcastRow } from './broadcast.service';
import { AudienceService } from '../(audience)/audience.service';
import { IList } from '../(audience)/audience.model';
import { BrandKitService } from '../(email-brand)/brand-kit.service';
import { EmailBlockEditorComponent, BlockEditorSaveEvent } from '../../../../shared/components/email-block-editor/email-block-editor.component';
import { TestSendDialogComponent } from '../../../../shared/components/test-send-dialog/test-send-dialog.component';
import { IEmailBrandKit, DEFAULT_BRAND_KIT, EmailDesign } from '../../../../shared/email-compiler/email-design.model';
import { Functions, httpsCallable } from '@angular/fire/functions';

export const routeMeta: RouteMeta = {
    title: 'Broadcasts | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule,
        MatFormFieldModule, MatSelectModule, MatSlideToggleModule, MatDialogModule,
        GlobalTableComponent, EmailBlockEditorComponent, PageHeaderComponent,
    ],
    templateUrl: './broadcasts.page.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class BroadcastsPageComponent implements OnInit {
    private service = inject(BroadcastService);
    private audience = inject(AudienceService);
    private brandKitService = inject(BrandKitService);
    private functions = inject(Functions);
    private toast = inject(ToastService);
    private dialog = inject(MatDialog);
    private sanitizer = inject(DomSanitizer);
    private destroyRef = inject(DestroyRef);

    /** 'list' shows past/scheduled broadcasts; 'compose' shows the editor. */
    mode = signal<'list' | 'compose'>('list');

    lists = signal<IList[]>([]);
    recent = signal<BroadcastRow[]>([]);
    loading = signal(true);
    brandKit = signal<IEmailBrandKit>({ ...DEFAULT_BRAND_KIT });

    // Composer state
    subject = '';
    listId = '';
    premiumType = '';
    schedule = false;
    scheduledAt = '';
    content = signal<BlockEditorSaveEvent | null>(null);

    eligible = signal<number | null>(null);
    previewing = signal(false);
    sending = signal(false);

    starterDesign: EmailDesign = { blocks: [
        { id: 'h', type: 'heading', text: 'Big news', level: 1 },
        { id: 'p', type: 'paragraph', html: 'Hi ##NAME##, here is what is new…' },
    ] };

    columns: TableColumn[] = [
        { key: 'subject', header: 'Subject', type: 'text', classFn: () => 'fw-medium', transformFn: (r) => r.subject || '(no subject)' },
        {
            key: 'status', header: 'Status', type: 'html',
            transformFn: (r) => `<span class="${statusBadgeClass(r.status)}">${r.status}</span>`,
        },
        {
            key: 'results', header: 'Results', type: 'text', classFn: () => 'small',
            transformFn: (r) => r.status === 'completed'
                ? `${r.sentCount || 0} sent · ${r.skippedCount || 0} skipped · ${r.failedCount || 0} failed`
                : '—',
        },
        { key: 'scheduledAt', header: 'Scheduled', type: 'date', dateFormat: 'MMM d, y, h:mm a' },
        {
            key: 'actions', header: 'Actions', type: 'actions',
            actions: [
                {
                    action: 'cancel', icon: 'fas fa-ban text-danger', label: 'Cancel', class: 'delete',
                    hide: (row) => row.status !== 'scheduled', onAction: (row) => this.confirmCancel(row),
                },
            ],
        },
    ];

    ngOnInit(): void {
        this.audience.getLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((l) => this.lists.set(l));
        this.service.watchRecent().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((r) => {
            this.recent.set(r);
            this.loading.set(false);
        });
        this.brandKitService.getBrandKit().subscribe((k) => this.brandKit.set(k));
    }

    startCompose(): void {
        this.subject = ''; this.listId = ''; this.premiumType = '';
        this.schedule = false; this.scheduledAt = '';
        this.content.set(null); this.eligible.set(null);
        this.mode.set('compose');
    }

    backToList(): void {
        this.mode.set('list');
    }

    private buildAudience(): BroadcastAudience {
        const audience: BroadcastAudience = { kind: 'list', listId: this.listId };
        if (this.premiumType.trim()) {
            audience.filters = [{ field: 'premiumType', op: '==', value: this.premiumType.trim() }];
        }
        return audience;
    }

    async preview(): Promise<void> {
        if (!this.listId) { this.toast.error('Pick a list first'); return; }
        this.previewing.set(true);
        try {
            const res = await this.service.previewAudience(this.buildAudience());
            this.eligible.set(res.data.eligible);
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to preview audience');
        } finally {
            this.previewing.set(false);
        }
    }

    onContentSaved(e: BlockEditorSaveEvent): void {
        this.content.set(e);
        this.toast.success('Content captured — ready to send');
    }

    async onTestSend(e: BlockEditorSaveEvent): Promise<void> {
        const subject = this.subject || 'Test broadcast';
        const to = await firstValueFrom(
            this.dialog.open(TestSendDialogComponent, { width: '420px', data: { subject } }).afterClosed(),
        );
        if (!to) return;
        try {
            await httpsCallable(this.functions, 'sendTestEmail')({ toEmail: to, subject, html: e.html });
            this.toast.success('Test queued');
        } catch (err) {
            console.error(err);
            this.toast.error('Failed to send test');
        }
    }

    async send(): Promise<void> {
        if (!this.subject.trim()) { this.toast.error('Add a subject'); return; }
        if (!this.listId) { this.toast.error('Pick a list'); return; }
        const content = this.content();
        if (!content) { this.toast.error('Click Save in the editor to capture content first'); return; }
        this.sending.set(true);
        try {
            const scheduledAt = this.schedule && this.scheduledAt ? new Date(this.scheduledAt) : null;
            await this.service.createBroadcast({
                subject: this.subject,
                html: content.html,
                audience: this.buildAudience(),
                scheduledAt,
            });
            this.toast.success(scheduledAt ? 'Broadcast scheduled' : 'Broadcast queued');
            this.mode.set('list');
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to create broadcast');
        } finally {
            this.sending.set(false);
        }
    }

    confirmCancel(row: BroadcastRow): void {
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Cancel the scheduled broadcast <strong>${row.subject || '(no subject)'}</strong>?`,
        );
        this.dialog.open(ConfirmationPopupComponent, {
            width: '350px',
            data: { dialogType: 'Confirm', dialogMessage: msg, btnText: 'Cancel broadcast', panelType: 'warn' },
        }).afterClosed().subscribe(async (result: boolean) => {
            if (!result) return;
            try {
                await this.service.cancel(row.id);
                this.toast.success('Broadcast cancelled');
            } catch (e) {
                console.error(e);
                this.toast.error('Failed to cancel');
            }
        });
    }
}
