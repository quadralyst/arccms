import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule } from '@angular/material/dialog';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { injectT } from '../../../core/i18n/inject-t';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { NotifyService } from '../../../../shared/services/notify.service';
import { escapeHtml } from '../../../../shared/utils/escape-html';
import { audienceStatusText } from '../(audience)/audience-status-text';
import { statusBadgeClass } from '../../../../shared/utils/status-badge';
import { AudienceService } from '../(audience)/audience.service';
import { IContact, IList, ITag } from '../(audience)/audience.model';
import { BroadcastService, BroadcastRow, audienceListIds } from '../(broadcasts)/broadcast.service';
import { DripService, DripCampaign } from '../(drips)/drip.service';
import { isOn } from '../../../core/features/features';
import { Functions } from '@angular/fire/functions';
import { arcCallable } from '../../../core/config/arc-functions';
import { APP_LIST_OPERATORS, AppListPreview } from '../(lists)/(app-list-conditions)/app-list-conditions.component';
import { APP_USERS_LIMIT_NOTE_KEY, APP_USERS_LIMIT_PARAMS } from '../(app-users)/app-users-limit';

/** Statuses with words under admin.broadcasts.status and admin.drips.status. */
const BROADCAST_STATUSES = ['queued', 'scheduled', 'processing', 'sending', 'paused', 'completed', 'cancelled', 'failed'] as const;
const DRIP_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;

/** A person an App users (live) list matches, as `previewAppList` returns them. */
interface LiveMember {
    docId: string;
    key: string;
    email: string;
    name: string;
    consent: string;
}

/**
 * One workspace per list: who is in it, what one-off sends went to it, and what
 * runs automatically for it (U4).
 *
 * The list is the unit of audience in the unified model, so this is where a
 * "waitlist" and a manual list become the same thing — a form-fed list is simply
 * one whose membership is derived, and therefore read-only here (U-D12).
 */
@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, RouterLink, MatButtonModule, MatIconModule, MatTabsModule,
        MatTooltipModule, MatDialogModule, GlobalTableComponent, PageHeaderComponent, TranslocoPipe,
    ],
    templateUrl: './list-hub.page.html',
    styleUrls: ['./list-hub.page.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class ListHubPageComponent implements OnInit {
    private audience = inject(AudienceService);
    private broadcasts = inject(BroadcastService);
    private drips = inject(DripService);
    private route = inject(ActivatedRoute);
    readonly emailMarketingOn = isOn('email-marketing');
    private router = inject(Router);
    private notify = inject(NotifyService);
    private confirm = inject(ConfirmService);
    private transloco = inject(TranslocoService);
    private t = injectT();
    /** The admin language as a signal, so computed text follows a language switch. */
    private lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
    private destroyRef = inject(DestroyRef);
    private functions = inject(Functions);

    listId = signal('');
    list = signal<IList | null>(null);
    members = signal<IContact[]>([]);
    tags = signal<ITag[]>([]);
    allBroadcasts = signal<BroadcastRow[]>([]);
    allCampaigns = signal<DripCampaign[]>([]);
    loading = signal(true);
    /** The list itself did not load: say so with Retry, not "List not found". */
    listError = signal(false);
    private listSub?: { unsubscribe(): void };
    /** The list's members did not load; the table shows it with Retry. */
    membersError = signal(false);
    /** The Broadcasts or Sequence tab did not load; each table shows it with Retry. */
    broadcastsError = signal(false);
    campaignsError = signal(false);
    busy = signal(false);
    private membersSub?: { unsubscribe(): void };
    private broadcastsSub?: { unsubscribe(): void };
    private campaignsSub?: { unsubscribe(): void };

    /** A form-fed list mirrors a signup form; membership is derived, not edited. */
    isFormFed = computed(() => !!this.list()?.formId);

    /**
     * An App users (live) list (CO6.5b): its members are whoever in the host app
     * matches its conditions right now, read on open. Nothing to edit here but
     * the conditions (on the Lists page).
     */
    isLive = computed(() => this.list()?.type === 'app');
    liveMembers = signal<LiveMember[]>([]);
    livePreview = signal<AppListPreview | null>(null);
    readonly limitNoteKey = APP_USERS_LIMIT_NOTE_KEY;
    readonly limitNoteParams = APP_USERS_LIMIT_PARAMS;

    /** Addresses that unsubscribed: one per address, as a send counts them. */
    unsubscribedOf(p: AppListPreview): number {
        return Math.max(0, p.withEmail - (p.sharedEmail ?? 0) - p.subscribed);
    }
    /** Reading the app's users failed: a plain sentence shows, the detail is in the console. */
    liveError = signal(false);

    /** The conditions in words, in the admin's language: "isPro is true and plan.tier is any of pro, business". */
    conditionSummary = computed(() => {
        this.lang(); // recompute on a language switch
        return (this.list()?.conditions ?? []).map((c) => {
            const key = APP_LIST_OPERATORS.find((o) => o.op === c.op)?.label;
            const label = key ? this.transloco.translate(key) : c.op;
            const value = Array.isArray(c.value) ? c.value.join(', ') : c.value ?? '';
            return `${c.field} ${label}${value ? ` ${value}` : ''}`;
        }).join(` ${this.t('admin.audience.hub.and')} `);
    });

    liveColumns: TableColumn[] = [
        { key: 'name', header: 'common.table.name', type: 'text', transformFn: (r) => r.name || '-' },
        { key: 'email', header: 'common.table.email', type: 'text', transformFn: (r) => r.email || this.t('admin.audience.hub.no_email_value') },
        { key: 'key', header: 'admin.audience.hub.unique_key', type: 'code' },
        {
            key: 'consent', header: 'common.table.status', type: 'html',
            transformFn: (r) => this.badge(r.consent, this.status(r.consent)),
        },
    ];

    tagsById = computed(() => new Map(this.tags().map((t) => [t.id, t])));

    counts = computed(() => {
        const m = this.members();
        const by = (v: string) => m.filter((c) => (c.consent?.marketing || 'subscribed') === v).length;
        return {
            total: m.length,
            subscribed: by('subscribed'),
            pending: by('pending'),
            unsubscribed: by('unsubscribed'),
            disabled: m.filter((c) => c.disabled).length,
        };
    });

    /**
     * Broadcasts targeting this list — by audience, or (for pre-U4 per-waitlist
     * sends, which have no `audience`) by the waitlist this list mirrors. Without
     * the second clause, retiring the old composer would hide all past sends.
     */
    listBroadcasts = computed(() => {
        const id = this.listId();
        const formId = this.list()?.formId;
        return this.allBroadcasts().filter((b) =>
            audienceListIds(b.audience).includes(id)
            || (!!b.waitlistId && !!formId && b.waitlistId === formId),
        );
    });

    /** Drip campaigns bound to this list. */
    listCampaigns = computed(() => this.allCampaigns().filter((c) => c.listId === this.listId()));

    memberColumns: TableColumn[] = [
        { key: 'email', header: 'common.table.email', type: 'text' },
        { key: 'name', header: 'common.table.name', type: 'text', transformFn: (r) => r.name || '-' },
        {
            key: 'tags', header: 'admin.audience.tags.title', type: 'tags',
            transformFn: (r) => (r.tags || []).map((id: string) => this.tagsById().get(id)).filter(Boolean),
        },
        {
            key: 'consent', header: 'common.table.status', type: 'html',
            transformFn: (r) => {
                if (r.disabled) return `<span class="status-badge is-dark">${escapeHtml(this.status('disabled'))}</span>`;
                const c = r.consent?.marketing || 'subscribed';
                return this.badge(c, this.status(c));
            },
        },
        {
            key: 'actions', header: 'common.table.actions', type: 'actions',
            actions: [
                {
                    action: 'disable', slot: 'emails', icon: 'fas fa-ban text-danger', label: 'admin.audience.hub.disable_emails', class: 'delete',
                    hide: (row) => !!row.disabled, onAction: (row) => this.confirmDisable(row),
                },
                {
                    action: 'enable', slot: 'emails', icon: 'fas fa-circle-check text-success', label: 'admin.audience.hub.enable_emails', class: 'edit',
                    hide: (row) => !row.disabled, onAction: (row) => this.setDisabled(row, false),
                },
                {
                    action: 'remove', icon: 'fas fa-user-minus text-danger', label: 'admin.audience.hub.remove_from_list', class: 'delete',
                    // Form-fed membership is derived from the form's member docs —
                    // removing it here would desync the two. Disable instead.
                    hide: () => this.isFormFed(), onAction: (row) => this.confirmRemove(row),
                },
            ],
        },
    ];

    broadcastColumns: TableColumn[] = [
        { key: 'subject', header: 'admin.audience.hub.subject', type: 'text', classFn: () => 'fw-medium' },
        {
            key: 'status', header: 'common.table.status', type: 'html',
            // The words the Broadcasts page uses ("Sent", not "completed").
            transformFn: (r) => this.badge(r.status, this.knownStatus('admin.broadcasts.status', BROADCAST_STATUSES, r.status)),
        },
        { key: 'sentCount', header: 'admin.audience.hub.sent', type: 'text', transformFn: (r) => r.sentCount ?? 0 },
        { key: 'skippedCount', header: 'admin.audience.hub.skipped', type: 'text', transformFn: (r) => r.skippedCount ?? 0 },
        { key: 'createdAt', header: 'admin.audience.hub.created', type: 'date', dateFormat: 'MMM d, y' },
    ];

    campaignColumns: TableColumn[] = [
        { key: 'name', header: 'admin.audience.hub.sequence', type: 'text', classFn: () => 'fw-medium' },
        {
            key: 'status', header: 'common.table.status', type: 'html',
            // The words the Sequences page uses.
            transformFn: (r) => this.badge(r.status, this.knownStatus('admin.drips.status', DRIP_STATUSES, r.status)),
        },
        { key: 'steps', header: 'admin.audience.hub.steps', type: 'text', transformFn: (r) => (r.steps || []).length },
        { key: 'enrolled', header: 'admin.audience.hub.enrolled', type: 'text', transformFn: (r) => r.counts?.enrolled ?? 0 },
    ];

    ngOnInit(): void {
        const id = this.route.snapshot.paramMap.get('listId') || '';
        this.listId.set(id);
        if (!id) {
            this.loading.set(false);
            return;
        }

        this.loadList();
        this.loadMembers();
        this.audience.getTags().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((t) => this.tags.set(t));
        if (!this.emailMarketingOn) return;
        this.loadBroadcasts();
        this.loadCampaigns();
    }

    /** Listen to the list itself; called again by Retry. */
    loadList(): void {
        this.listSub?.unsubscribe();
        this.loading.set(true);
        this.listError.set(false);
        let failed = false;
        this.listSub = this.audience.getList(this.listId(), () => { failed = true; })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((l) => {
                const conditionsChanged = JSON.stringify(l?.conditions) !== JSON.stringify(this.list()?.conditions);
                this.list.set(l);
                this.listError.set(failed);
                this.loading.set(false);
                if (l?.type === 'app' && (conditionsChanged || !this.livePreview())) void this.loadLive();
            });
    }

    /** Retry for the whole page: the list and its members. */
    retryList(): void {
        this.loadList();
        this.loadMembers();
    }

    /** The Broadcasts tab; called again by Retry. */
    loadBroadcasts(): void {
        this.broadcastsSub?.unsubscribe();
        this.broadcastsError.set(false);
        this.broadcastsSub = this.broadcasts.watchRecent(100, {
            onError: (err) => { console.error('List broadcasts did not load', err); this.broadcastsError.set(true); },
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((b) => this.allBroadcasts.set(b));
    }

    /** The Sequence tab; called again by Retry. */
    loadCampaigns(): void {
        this.campaignsSub?.unsubscribe();
        this.campaignsError.set(false);
        this.campaignsSub = this.drips.watchCampaigns({
            onError: (err) => { console.error('List sequences did not load', err); this.campaignsError.set(true); },
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((c) => this.allCampaigns.set(c));
    }

    /** Listen to the list's members; called again by Retry. */
    loadMembers(): void {
        this.membersSub?.unsubscribe();
        this.membersError.set(false);
        let failed = false;
        this.membersSub = this.audience.getContactsInList(this.listId(), 500, () => { failed = true; })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((c) => {
                this.members.set(c);
                this.membersError.set(failed);
            });
    }

    /** Who the live list matches now. */
    async loadLive(): Promise<void> {
        this.liveError.set(false);
        try {
            const res = await arcCallable<{ listId: string }, AppListPreview & { rows: LiveMember[] }>(this.functions, 'previewAppList')({ listId: this.listId() });
            this.livePreview.set(res.data);
            this.liveMembers.set(res.data.rows);
        } catch (e) {
            console.error('Reading the live list failed', e);
            this.liveError.set(true);
        }
    }

    /** A stored status (subscribed, pending...) in the admin's language. */
    private status(value: string): string {
        return audienceStatusText(this.transloco, value);
    }

    /** A status badge for an html column: the text is escaped, the class comes from a fixed map. */
    private badge(status: string, text: string): string {
        return `<span class="${statusBadgeClass(status)}">${escapeHtml(text)}</span>`;
    }

    /** A status from another page's own word list (`<prefix>.<status>`), else the audience words. */
    private knownStatus(prefix: string, known: readonly string[], value: string): string {
        return known.includes(value) ? this.transloco.translate(`${prefix}.${value}`) : this.status(value);
    }

    /** Compose a broadcast with this list pre-selected as the audience. */
    newBroadcast(): void {
        this.router.navigate(['/admin/email/broadcasts'], { queryParams: { listId: this.listId() } });
    }

    /** Create a sequence for this list. */
    newSequence(): void {
        this.router.navigate(['/admin/email/drip-campaigns'], { queryParams: { listId: this.listId() } });
    }

    viewForm(): void {
        const formId = this.list()?.formId;
        if (formId) this.router.navigate(['/admin/waitlists/dashboard', formId]);
    }

    async confirmDisable(contact: IContact): Promise<void> {
        const ok = await this.confirm.ask({
            titleKey: 'admin.audience.hub.disable_title',
            dialogMessage: this.t('admin.audience.hub.disable_confirm', { email: escapeHtml(contact.email) }),
            btnText: this.t('admin.audience.hub.disable_emails'),
            panelType: 'warn',
        });
        if (ok) await this.setDisabled(contact, true);
    }

    async setDisabled(contact: IContact, disabled: boolean): Promise<void> {
        if (!contact.id) return;
        this.busy.set(true);
        try {
            await this.audience.setContactDisabled(contact.id, disabled);
            this.notify.success(disabled ? 'admin.audience.hub.disabled_done' : 'admin.audience.hub.enabled_done');
        } catch (e) {
            console.error('Changing the contact\'s emails failed', e);
            this.notify.error('admin.audience.hub.update_failed');
        } finally {
            this.busy.set(false);
        }
    }

    async confirmRemove(contact: IContact): Promise<void> {
        const ok = await this.confirm.ask({
            titleKey: 'common.actions.remove',
            dialogMessage: this.t('admin.audience.hub.remove_confirm', { email: escapeHtml(contact.email), list: escapeHtml(this.list()?.name || '') }),
            btnText: this.t('common.actions.remove'),
            panelType: 'warn',
        }, '360px');
        if (!ok || !contact.id) return;
        this.busy.set(true);
        try {
            await this.audience.updateContactLists(contact.id, [], [this.listId()]);
            this.notify.success('admin.audience.hub.removed');
        } catch (e) {
            console.error('Removing the contact from the list failed', e);
            this.notify.error('admin.audience.hub.remove_failed');
        } finally {
            this.busy.set(false);
        }
    }
}
