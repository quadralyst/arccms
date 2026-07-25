import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { statusBadgeClass } from '../../../../shared/utils/status-badge';
import { AudienceService } from '../(audience)/audience.service';
import { IContact, IList, ITag } from '../(audience)/audience.model';
import { BroadcastService, BroadcastRow, audienceListIds } from '../(broadcasts)/broadcast.service';
import { DripService, DripCampaign } from '../(drips)/drip.service';

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
        MatTooltipModule, MatDialogModule, GlobalTableComponent, PageHeaderComponent,
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
    private router = inject(Router);
    private toast = inject(ToastService);
    private dialog = inject(MatDialog);
    private sanitizer = inject(DomSanitizer);
    private destroyRef = inject(DestroyRef);

    listId = signal('');
    list = signal<IList | null>(null);
    members = signal<IContact[]>([]);
    tags = signal<ITag[]>([]);
    allBroadcasts = signal<BroadcastRow[]>([]);
    allCampaigns = signal<DripCampaign[]>([]);
    loading = signal(true);
    busy = signal(false);

    /** A form-fed list mirrors a signup form; membership is derived, not edited. */
    isFormFed = computed(() => !!this.list()?.formId);

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

    /** Broadcasts whose audience includes this list. */
    listBroadcasts = computed(() => {
        const id = this.listId();
        return this.allBroadcasts().filter((b) => audienceListIds(b.audience).includes(id));
    });

    /** Drip campaigns bound to this list. */
    listCampaigns = computed(() => this.allCampaigns().filter((c) => c.listId === this.listId()));

    memberColumns: TableColumn[] = [
        { key: 'email', header: 'Email', type: 'text' },
        { key: 'name', header: 'Name', type: 'text', transformFn: (r) => r.name || '—' },
        {
            key: 'tags', header: 'Tags', type: 'tags',
            transformFn: (r) => (r.tags || []).map((id: string) => this.tagsById().get(id)).filter(Boolean),
        },
        {
            key: 'consent', header: 'Status', type: 'html',
            transformFn: (r) => {
                if (r.disabled) return '<span class="status-badge is-dark">disabled</span>';
                const c = r.consent?.marketing || 'subscribed';
                return `<span class="${statusBadgeClass(c)}">${c}</span>`;
            },
        },
        {
            key: 'actions', header: 'Actions', type: 'actions',
            actions: [
                {
                    action: 'disable', icon: 'fas fa-ban text-danger', label: 'Disable emails', class: 'delete',
                    hide: (row) => !!row.disabled, onAction: (row) => this.confirmDisable(row),
                },
                {
                    action: 'enable', icon: 'fas fa-circle-check text-success', label: 'Re-enable emails', class: 'edit',
                    hide: (row) => !row.disabled, onAction: (row) => this.setDisabled(row, false),
                },
                {
                    action: 'remove', icon: 'fas fa-user-minus text-danger', label: 'Remove from list', class: 'delete',
                    // Form-fed membership is derived from the form's member docs —
                    // removing it here would desync the two. Disable instead.
                    hide: () => this.isFormFed(), onAction: (row) => this.confirmRemove(row),
                },
            ],
        },
    ];

    broadcastColumns: TableColumn[] = [
        { key: 'subject', header: 'Subject', type: 'text', classFn: () => 'fw-medium' },
        {
            key: 'status', header: 'Status', type: 'html',
            transformFn: (r) => `<span class="${statusBadgeClass(r.status)}">${r.status}</span>`,
        },
        { key: 'sentCount', header: 'Sent', type: 'text', transformFn: (r) => r.sentCount ?? 0 },
        { key: 'skippedCount', header: 'Skipped', type: 'text', transformFn: (r) => r.skippedCount ?? 0 },
        { key: 'createdAt', header: 'Created', type: 'date', dateFormat: 'MMM d, y' },
    ];

    campaignColumns: TableColumn[] = [
        { key: 'name', header: 'Sequence', type: 'text', classFn: () => 'fw-medium' },
        {
            key: 'status', header: 'Status', type: 'html',
            transformFn: (r) => `<span class="${statusBadgeClass(r.status)}">${r.status}</span>`,
        },
        { key: 'steps', header: 'Steps', type: 'text', transformFn: (r) => (r.steps || []).length },
        { key: 'enrolled', header: 'Enrolled', type: 'text', transformFn: (r) => r.counts?.enrolled ?? 0 },
    ];

    ngOnInit(): void {
        const id = this.route.snapshot.paramMap.get('listId') || '';
        this.listId.set(id);
        if (!id) {
            this.loading.set(false);
            return;
        }

        this.audience.getList(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((l) => {
            this.list.set(l);
            this.loading.set(false);
        });
        this.audience.getContactsInList(id).pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((c) => this.members.set(c));
        this.audience.getTags().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((t) => this.tags.set(t));
        this.broadcasts.watchRecent(100).pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((b) => this.allBroadcasts.set(b));
        this.drips.watchCampaigns().pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((c) => this.allCampaigns.set(c));
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

    confirmDisable(contact: IContact): void {
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Stop sending <strong>all</strong> email to <strong>${this.escape(contact.email)}</strong>?` +
            `<br><br>They stay in the list and keep their history. This also blocks verification ` +
            `emails, so they can't confirm a new signup until re-enabled.`,
        );
        this.dialog.open(ConfirmationPopupComponent, {
            width: '380px',
            data: { dialogType: 'Disable', dialogMessage: msg, btnText: 'Disable emails', panelType: 'warn' },
        }).afterClosed().subscribe((ok: boolean) => {
            if (ok) this.setDisabled(contact, true);
        });
    }

    async setDisabled(contact: IContact, disabled: boolean): Promise<void> {
        if (!contact.id) return;
        this.busy.set(true);
        try {
            await this.audience.setContactDisabled(contact.id, disabled);
            this.toast.success(disabled ? 'Emails disabled for this contact' : 'Emails re-enabled');
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to update the contact');
        } finally {
            this.busy.set(false);
        }
    }

    confirmRemove(contact: IContact): void {
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Remove <strong>${this.escape(contact.email)}</strong> from <strong>${this.escape(this.list()?.name || '')}</strong>?`,
        );
        this.dialog.open(ConfirmationPopupComponent, {
            width: '360px',
            data: { dialogType: 'Remove', dialogMessage: msg, btnText: 'Remove', panelType: 'warn' },
        }).afterClosed().subscribe(async (ok: boolean) => {
            if (!ok || !contact.id) return;
            this.busy.set(true);
            try {
                await this.audience.updateContactLists(contact.id, [], [this.listId()]);
                this.toast.success('Removed from list');
            } catch (e) {
                console.error(e);
                this.toast.error('Failed to remove from list');
            } finally {
                this.busy.set(false);
            }
        });
    }

    private escape(value: string): string {
        return (value || '').replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
        ));
    }
}
