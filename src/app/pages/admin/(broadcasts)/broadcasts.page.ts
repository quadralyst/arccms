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
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, Subscription } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { statusBadgeClass, statusBadgeLabel } from '../../../../shared/utils/status-badge';
import { injectT } from '../../../core/i18n/inject-t';
import { isTranslationKey } from '../../../core/i18n/translatable.pipe';
import { BroadcastService, BroadcastAudience, BroadcastRow } from './broadcast.service';
import { AudienceService } from '../(audience)/audience.service';
import { IList } from '../(audience)/audience.model';
import { BrandKitService } from '../(email-brand)/brand-kit.service';
import { EmailBlockEditorComponent, BlockEditorSaveEvent } from '../../../../shared/components/email-block-editor/email-block-editor.component';
import { TestSendDialogComponent } from '../../../../shared/components/test-send-dialog/test-send-dialog.component';
import { IEmailBrandKit, DEFAULT_BRAND_KIT, EmailDesign } from '../../../../shared/email-compiler/email-design.model';
import { Functions } from '@angular/fire/functions';
import { HashtagAutocompleteDirective } from '../../../../shared/directives/hashtag-autocomplete/hashtag-autocomplete.directive';
import { appFieldTags, EMAIL_TAG } from '../../../../shared/constants/email-tags';
import { arcCallable } from '../../../core/config/arc-functions';
import { MAX_APP_USERS } from '../(app-users)/app-users-limit';
import { escapeHtml } from '../../../../shared/utils/escape-html';

export const routeMeta: RouteMeta = {
    title: 'Broadcasts',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule,
        MatFormFieldModule, MatSelectModule, MatSlideToggleModule, MatDialogModule,
        GlobalTableComponent, EmailBlockEditorComponent, PageHeaderComponent,
        HashtagAutocompleteDirective, TranslocoPipe,
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
    private route = inject(ActivatedRoute);
    private destroyRef = inject(DestroyRef);
    private readonly t = injectT();

    /** 'list' shows past/scheduled broadcasts; 'compose' shows the editor. */
    mode = signal<'list' | 'compose'>('list');

    lists = signal<IList[]>([]);
    recent = signal<BroadcastRow[]>([]);
    loading = signal(true);
    /** Set when the broadcasts did not load: the table says so and offers Retry. */
    loadError = signal<string | boolean | null>(null);
    private recentSub?: Subscription;
    brandKit = signal<IEmailBrandKit>({ ...DEFAULT_BRAND_KIT });

    private readonly baseTags = [EMAIL_TAG.NAME, EMAIL_TAG.EMAIL, EMAIL_TAG.UNSUBSCRIBE_LINK, EMAIL_TAG.PREFERENCES_LINK];
    /** `##APP.<field>##` for the App audience fields; null until first needed. */
    private readonly appTags = signal<string[] | null>(null);
    private loadingAppTags = false;
    /**
     * Merge tags offered by the `#` autocomplete in the subject + block body.
     * With an App users (live) list in the audience, its fields are offered too.
     */
    readonly broadcastTags = signal<string[]>([...this.baseTags]);

    // Composer state
    subject = '';
    /** Lists to send to (U4). Union, de-duplicated per contact server-side. */
    includeListIds: string[] = [];
    /** Lists to subtract from that union. */
    excludeListIds: string[] = [];
    premiumType = '';
    schedule = false;
    scheduledAt = '';
    content = signal<BlockEditorSaveEvent | null>(null);

    eligible = signal<number | null>(null);
    /** A live list in the audience read only the first app users (review C2). */
    appUsersCapped = signal(false);
    readonly maxAppUsers = MAX_APP_USERS.toLocaleString();
    previewing = signal(false);
    sending = signal(false);

    /** The first blocks of a new broadcast, in the admin's language (set on compose). */
    starterDesign: EmailDesign = { blocks: [] };

    columns: TableColumn[] = [
        {
            key: 'subject', header: 'admin.broadcasts.subject', type: 'text', classFn: () => 'fw-medium',
            transformFn: (r) => r.subject || this.t('admin.broadcasts.no_subject'),
        },
        {
            key: 'status', header: 'common.table.status', type: 'badge',
            badgeConfig: { textFn: (r) => this.statusText(r.status) },
            classFn: (r) => statusBadgeClass(r.status),
        },
        {
            key: 'results', header: 'admin.broadcasts.col_results', type: 'text', classFn: () => 'small',
            transformFn: (r) => r.status === 'completed'
                ? this.t('admin.broadcasts.results', { sent: r.sentCount || 0, skipped: r.skippedCount || 0, failed: r.failedCount || 0 })
                : '-',
        },
        { key: 'scheduledAt', header: 'admin.broadcasts.col_scheduled', type: 'date', dateFormat: 'MMM d, y, h:mm a' },
        {
            key: 'actions', header: 'common.table.actions', type: 'actions',
            actions: [
                {
                    action: 'cancel', icon: 'fas fa-ban text-danger', label: 'admin.broadcasts.cancel_broadcast', class: 'delete',
                    hide: (row) => row.status !== 'scheduled', onAction: (row) => this.confirmCancel(row),
                },
            ],
        },
    ];

    ngOnInit(): void {
        this.audience.getLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((l) => {
            this.lists.set(l);
            void this.refreshTags();
        });
        this.load();
        this.brandKitService.getBrandKit().subscribe((k) => this.brandKit.set(k));

        // Arriving from a list hub's "New broadcast to this list" (U4): open the
        // composer with that list already targeted.
        const listId = this.route.snapshot.queryParamMap.get('listId');
        if (listId) this.startCompose(listId);
    }

    /** Read the latest broadcasts (live). Retry calls it again after a failed read. */
    load(): void {
        this.recentSub?.unsubscribe();
        this.loading.set(true);
        this.loadError.set(null);
        this.recentSub = this.service.watchRecent(20, { surfaceErrors: true })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (r) => {
                    this.recent.set(r);
                    this.loadError.set(null);
                    this.loading.set(false);
                },
                error: () => {
                    // The service logged the detail.
                    this.loadError.set(true);
                    this.loading.set(false);
                },
            });
    }

    /** A broadcast's status in the admin's language. */
    statusText(status: string): string {
        const key = `admin.broadcasts.status.${status}`;
        return isTranslationKey(key) ? this.t(key) : statusBadgeLabel(status);
    }

    startCompose(presetListId = ''): void {
        this.starterDesign = { blocks: [
            { id: 'h', type: 'heading', text: this.t('admin.broadcasts.starter_heading'), level: 1 },
            { id: 'p', type: 'paragraph', html: this.t('admin.broadcasts.starter_text') },
        ] };
        this.subject = '';
        this.includeListIds = presetListId ? [presetListId] : [];
        this.excludeListIds = [];
        this.premiumType = '';
        this.schedule = false; this.scheduledAt = '';
        this.content.set(null); this.eligible.set(null);
        this.mode.set('compose');
        void this.refreshTags();
    }

    onIncludeChange(): void {
        this.eligible.set(null);
        void this.refreshTags();
    }

    private includesAppList(): boolean {
        return this.lists().some((l) => l.type === 'app' && this.includeListIds.includes(l.id));
    }

    /** Offer the App audience fields as tags while an App users (live) list is in the audience. */
    async refreshTags(): Promise<void> {
        if (this.includesAppList() && this.appTags() === null && !this.loadingAppTags) {
            this.loadingAppTags = true;
            try {
                const res = await arcCallable<void, { fields: Array<{ path: string; hidden?: boolean }> }>(this.functions, 'sampleAppUsers')();
                this.appTags.set(appFieldTags(res.data.fields ?? []));
            } catch (err) {
                console.warn('Broadcasts: could not read the App audience fields for tags.', err);
                this.appTags.set([]);
            } finally {
                this.loadingAppTags = false;
            }
        }
        this.broadcastTags.set(this.includesAppList() ? [...this.baseTags, ...(this.appTags() ?? [])] : [...this.baseTags]);
    }

    backToList(): void {
        this.mode.set('list');
    }

    private buildAudience(): BroadcastAudience {
        const audience: BroadcastAudience = { include: [...this.includeListIds] };
        if (this.excludeListIds.length) {
            // Only meaningful against the union; a list in both would cancel itself
            // out, which the picker prevents.
            audience.exclude = [...this.excludeListIds];
        }
        if (this.premiumType.trim()) {
            audience.filters = [{ field: 'premiumType', op: '==', value: this.premiumType.trim() }];
        }
        return audience;
    }

    async preview(): Promise<void> {
        if (!this.includeListIds.length) { this.toast.error(this.t('admin.broadcasts.pick_list')); return; }
        this.previewing.set(true);
        try {
            const res = await this.service.previewAudience(this.buildAudience());
            this.eligible.set(res.data.eligible);
            this.appUsersCapped.set(!!res.data.appUsersCapped);
        } catch (e) {
            console.error(e);
            this.toast.error(this.t('admin.broadcasts.preview_failed'));
        } finally {
            this.previewing.set(false);
        }
    }

    onContentSaved(e: BlockEditorSaveEvent): void {
        this.content.set(e);
        this.toast.success(this.t('admin.broadcasts.content_saved'));
    }

    async onTestSend(e: BlockEditorSaveEvent): Promise<void> {
        const subject = this.subject || this.t('admin.broadcasts.test_subject');
        const to = await firstValueFrom(
            this.dialog.open(TestSendDialogComponent, { width: '420px', data: { subject } }).afterClosed(),
        );
        if (!to) return;
        try {
            await arcCallable(this.functions, 'sendTestEmail')({ toEmail: to, subject, html: e.html });
            this.toast.success(this.t('admin.broadcasts.test_queued'));
        } catch (err) {
            console.error(err);
            this.toast.error(this.t('admin.broadcasts.test_failed'));
        }
    }

    async send(): Promise<void> {
        if (!this.subject.trim()) { this.toast.error(this.t('admin.broadcasts.add_subject')); return; }
        if (!this.includeListIds.length) { this.toast.error(this.t('admin.broadcasts.pick_list')); return; }
        const content = this.content();
        if (!content) { this.toast.error(this.t('admin.broadcasts.save_content_first')); return; }
        this.sending.set(true);
        try {
            const scheduledAt = this.schedule && this.scheduledAt ? new Date(this.scheduledAt) : null;
            await this.service.createBroadcast({
                subject: this.subject,
                html: content.html,
                audience: this.buildAudience(),
                scheduledAt,
            });
            this.toast.success(this.t(scheduledAt ? 'admin.broadcasts.scheduled' : 'admin.broadcasts.queued'));
            this.mode.set('list');
        } catch (e) {
            console.error(e);
            this.toast.error(this.t('admin.broadcasts.create_failed'));
        } finally {
            this.sending.set(false);
        }
    }

    confirmCancel(row: BroadcastRow): void {
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            this.t('admin.broadcasts.cancel_confirm', { subject: escapeHtml(row.subject || this.t('admin.broadcasts.no_subject')) }),
        );
        this.dialog.open(ConfirmationPopupComponent, {
            width: '350px',
            data: {
                dialogType: 'Confirm', titleKey: 'admin.broadcasts.cancel_title', dialogMessage: msg,
                btnText: this.t('admin.broadcasts.cancel_broadcast'), panelType: 'warn',
            },
        }).afterClosed().subscribe(async (result: boolean) => {
            if (!result) return;
            try {
                await this.service.cancel(row.id);
                this.toast.success(this.t('admin.broadcasts.cancelled'));
            } catch (e) {
                console.error(e);
                this.toast.error(this.t('admin.broadcasts.cancel_failed'));
            }
        });
    }
}
