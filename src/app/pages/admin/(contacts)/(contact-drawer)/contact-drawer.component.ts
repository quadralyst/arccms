import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, OnChanges, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ConfirmationPopupComponent } from '../../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { escapeHtml } from '../../../../../shared/utils/escape-html';
import { audienceStatusText } from '../../(audience)/audience-status-text';
import { AudienceService } from '../../(audience)/audience.service';
import { IContact, IList, ITag, IContactField, ICsvPreview, MarketingConsent } from '../../(audience)/audience.model';

export type ContactDrawerMode = 'add' | 'import' | 'view';

/**
 * Right-side drawer content for the Contacts page: add a contact, import a CSV,
 * or view a contact and change its marketing consent. Owns its own mutations
 * via AudienceService (mirroring the users/(add-user) pattern) and emits
 * `saved`/`close` for the host to react.
 */
@Component({
    selector: 'arc-contact-drawer',
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule,
        MatInputModule, MatFormFieldModule, MatSelectModule, MatCheckboxModule,
        MatDialogModule, TranslocoPipe,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="side-panel">
        <div class="panel-header">
            <h5>
                @switch (mode) {
                    @case ('add') { {{ 'admin.audience.contacts.add' | transloco }} }
                    @case ('import') { {{ 'admin.audience.contacts.import_title' | transloco }} }
                    @default { {{ 'admin.audience.contacts.contact' | transloco }} }
                }
            </h5>
            <button type="button" class="close-btn" (click)="close.emit()" [attr.aria-label]="'common.actions.close' | transloco"><i class="fas fa-times" aria-hidden="true"></i></button>
        </div>

        <!-- Add -->
        @if (mode === 'add') {
        <div class="flex-grow-1">
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>{{ 'common.table.email' | transloco }}</mat-label>
                <input matInput type="email" [(ngModel)]="newEmail" placeholder="person&#64;example.com" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>{{ 'admin.audience.contacts.name_optional' | transloco }}</mat-label>
                <input matInput [(ngModel)]="newName" />
            </mat-form-field>
            <mat-checkbox [(ngModel)]="newConsent">{{ 'admin.audience.contacts.have_consent' | transloco }}</mat-checkbox>
        </div>
        <div class="panel-actions">
            <button mat-stroked-button (click)="close.emit()">{{ 'common.actions.cancel' | transloco }}</button>
            <button mat-flat-button color="primary" [disabled]="busy()" (click)="addContact()">
                <mat-icon aria-hidden="true">person_add</mat-icon> {{ 'admin.audience.contacts.add' | transloco }}
            </button>
        </div>
        }

        <!-- Import -->
        @if (mode === 'import') {
        <div class="flex-grow-1">
            <p class="small text-muted" [innerHTML]="'admin.audience.contacts.import_hint' | transloco"></p>
            <textarea class="form-control mb-2" rows="6" [(ngModel)]="csvText"
                [attr.aria-label]="'admin.audience.contacts.import_rows' | transloco"
                placeholder="email,name&#10;alice&#64;example.com,Alice"></textarea>
            <button mat-stroked-button [disabled]="busy() || !csvText.trim()" (click)="previewCsv()">{{ 'admin.audience.contacts.preview' | transloco }}</button>

            @if (csvPreview(); as p) {
            <div class="mt-3">
                <p class="mb-2">
                    <span class="text-success">{{ 'admin.audience.contacts.valid_count' | transloco: { count: p.validCount } }}</span> ·
                    <span class="text-warning">{{ 'admin.audience.contacts.duplicate_count' | transloco: { count: p.duplicateCount } }}</span> ·
                    <span class="text-danger">{{ 'admin.audience.contacts.invalid_count' | transloco: { count: p.invalidCount } }}</span>
                </p>
                <mat-form-field appearance="outline" class="w-100">
                    <mat-label>{{ 'admin.audience.contacts.add_to_list' | transloco }}</mat-label>
                    <mat-select [(ngModel)]="importListId">
                        @for (list of lists; track list.id) {
                        <mat-option [value]="list.id">{{ list.name }}</mat-option>
                        }
                    </mat-select>
                </mat-form-field>
                <mat-checkbox [(ngModel)]="importConsent">{{ 'admin.audience.contacts.import_consent' | transloco }}</mat-checkbox>
                <p class="small text-muted mt-2">{{ 'admin.audience.contacts.import_consent_hint' | transloco }}</p>
            </div>
            }
        </div>
        <div class="panel-actions">
            <button mat-stroked-button (click)="close.emit()">{{ 'common.actions.cancel' | transloco }}</button>
            @if (csvPreview(); as p) {
            <button mat-flat-button color="primary" [disabled]="busy() || !p.validCount || !importListId" (click)="importCsv()">
                {{ 'admin.audience.contacts.import_n' | transloco: { count: p.validCount } }}
            </button>
            }
        </div>
        }

        <!-- View + consent -->
        @if (mode === 'view' && contact) {
        <div class="flex-grow-1">
            <dl class="row mb-3">
                <dt class="col-4 text-muted small">{{ 'common.table.email' | transloco }}</dt>
                <dd class="col-8">{{ contact.email }}</dd>
                <dt class="col-4 text-muted small">{{ 'common.table.name' | transloco }}</dt>
                <dd class="col-8">{{ contact.name || '-' }}</dd>
                <dt class="col-4 text-muted small">{{ 'admin.audience.contacts.sources' | transloco }}</dt>
                <dd class="col-8">{{ (contact.sources || []).join(', ') || '-' }}</dd>
                <dt class="col-4 text-muted small">{{ 'admin.audience.contacts.lists' | transloco }}</dt>
                <dd class="col-8">{{ (contact.listIds || []).length }}</dd>
                <dt class="col-4 text-muted small">{{ 'admin.audience.contacts.consent' | transloco }}</dt>
                <dd class="col-8">
                    <span [class]="consentBadge(contact)">{{ consentText(contact) }}</span>
                </dd>
            </dl>

            @if (contact.consent?.marketing === 'pending') {
            <p class="small text-muted mb-3">
                <i class="fas fa-circle-info me-1" aria-hidden="true"></i>
                {{ 'admin.audience.contacts.pending_note' | transloco }}
            </p>
            }

            @if (allFields.length) {
            <h6 class="form-label small text-muted d-block">{{ 'admin.audience.fields.title' | transloco }}</h6>
            <div class="mb-3">
                @for (f of allFields; track f.key) {
                    <mat-form-field appearance="outline" class="w-100">
                        <mat-label>{{ f.label }}</mat-label>
                        <input matInput [ngModel]="fieldValues[f.key]"
                            (ngModelChange)="fieldValues[f.key] = $event" [disabled]="busy()" />
                    </mat-form-field>
                }
                <button mat-stroked-button color="primary" [disabled]="busy()" (click)="saveFields()">
                    <mat-icon aria-hidden="true">save</mat-icon> {{ 'admin.audience.contacts.save_fields' | transloco }}
                </button>
            </div>
            }

            <h6 class="form-label small text-muted d-block">{{ 'admin.audience.tags.title' | transloco }}</h6>
            @if (allTags.length) {
            <div class="d-flex flex-wrap gap-2 mb-3">
                @for (t of allTags; track t.id) {
                    <button type="button" class="tag-toggle" [class.is-on]="selectedTags.includes(t.id)"
                        [style.background]="selectedTags.includes(t.id) ? t.color : 'transparent'"
                        [style.border-color]="t.color"
                        [style.color]="selectedTags.includes(t.id) ? '#fff' : t.color"
                        [attr.aria-pressed]="selectedTags.includes(t.id)"
                        [disabled]="busy()" (click)="toggleTag(t.id)">
                        {{ t.label }}
                    </button>
                }
            </div>
            } @else {
            <p class="small text-muted mb-3">{{ 'admin.audience.contacts.no_tags' | transloco }}</p>
            }

            <hr class="my-3" />
            <h6 class="form-label small text-muted d-block">{{ 'admin.audience.contacts.erase_heading' | transloco }}</h6>
            <p class="small text-muted mb-2">{{ 'admin.audience.contacts.erase_hint' | transloco }}</p>
            <button mat-stroked-button color="warn" [disabled]="busy()" (click)="confirmErase()">
                <mat-icon aria-hidden="true">delete_forever</mat-icon> {{ 'admin.audience.contacts.erase' | transloco }}
            </button>
        </div>
        <div class="panel-actions">
            @if (contact.consent?.marketing !== 'subscribed') {
            <button mat-stroked-button color="primary" [disabled]="busy()" (click)="setConsent('subscribed')">{{ 'admin.audience.contacts.subscribe' | transloco }}</button>
            }
            @if (contact.consent?.marketing !== 'unsubscribed') {
            <button mat-stroked-button color="warn" [disabled]="busy()" (click)="setConsent('unsubscribed')">{{ 'admin.audience.contacts.suppress' | transloco }}</button>
            }
        </div>
        }
    </div>
    `,
})
export class ContactDrawerComponent implements OnChanges {
    @Input() mode: ContactDrawerMode = 'add';
    @Input() lists: IList[] = [];
    @Input() allTags: ITag[] = [];
    @Input() allFields: IContactField[] = [];
    @Input() contact: IContact | null = null;
    @Output() close = new EventEmitter<void>();
    @Output() saved = new EventEmitter<void>();

    private audience = inject(AudienceService);
    private notify = inject(NotifyService);
    private dialog = inject(MatDialog);
    private transloco = inject(TranslocoService);

    busy = signal(false);

    /** Local copy so a failed save doesn't leave the chips lying about state. */
    selectedTags: string[] = [];
    /** Editable copy of the contact's custom field values (U4.5). */
    fieldValues: Record<string, string> = {};

    ngOnChanges(): void {
        this.selectedTags = [...(this.contact?.tags || [])];
        const stored = (this.contact?.fields || {}) as Record<string, unknown>;
        this.fieldValues = Object.fromEntries(
            this.allFields.map((f) => [f.key, stored[f.key] === undefined ? '' : String(stored[f.key])]),
        );
    }

    /**
     * Save all field values at once. Admin edits use the force path server-side, so
     * they win over the per-field fill policy — that policy exists to stop *forms*
     * overwriting each other, not people.
     */
    async saveFields(): Promise<void> {
        if (!this.contact?.id) return;
        this.busy.set(true);
        try {
            await this.audience.setContactFields(this.contact.id, { ...this.fieldValues });
            this.notify.success('admin.audience.contacts.fields_saved');
        } catch (e) {
            console.error('Saving contact fields failed', e);
            this.notify.error('admin.audience.contacts.fields_save_failed');
        } finally {
            this.busy.set(false);
        }
    }

    /** Tag changes save immediately — there is no Save button in view mode. */
    async toggleTag(tagId: string): Promise<void> {
        if (!this.contact?.id) return;
        const previous = [...this.selectedTags];
        this.selectedTags = this.selectedTags.includes(tagId)
            ? this.selectedTags.filter((t) => t !== tagId)
            : [...this.selectedTags, tagId];

        this.busy.set(true);
        try {
            await this.audience.setContactTags(this.contact.id, this.selectedTags);
            // Deliberately no `saved` emit: the host closes the drawer on it, and
            // the contacts table is realtime, so it already reflects the change.
        } catch (e) {
            console.error('Saving contact tags failed', e);
            this.selectedTags = previous;
            this.notify.error('admin.audience.contacts.tags_save_failed');
        } finally {
            this.busy.set(false);
        }
    }

    // add form
    newEmail = '';
    newName = '';
    newConsent = false;

    // csv import
    csvText = '';
    csvPreview = signal<ICsvPreview | null>(null);
    importListId = '';
    importConsent = false;

    consentBadge(c: IContact): string {
        const m = c.consent?.marketing;
        const tone = m === 'subscribed' ? 'is-success' : m === 'unsubscribed' ? 'is-danger' : 'is-warning';
        return `status-badge ${tone}`;
    }

    consentText(c: IContact): string {
        return audienceStatusText(this.transloco, c.consent?.marketing || 'pending');
    }

    async addContact(): Promise<void> {
        const email = this.newEmail.trim().toLowerCase();
        if (!email.includes('@')) { this.notify.error('admin.audience.contacts.email_invalid'); return; }
        this.busy.set(true);
        try {
            await this.audience.addContact(email, this.newName.trim(), [], this.newConsent);
            this.notify.success('admin.audience.contacts.added');
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error('Adding the contact failed', e);
            this.notify.error('admin.audience.contacts.add_failed');
        } finally {
            this.busy.set(false);
        }
    }

    async previewCsv(): Promise<void> {
        if (!this.csvText.trim()) return;
        this.busy.set(true);
        try {
            const res = await this.audience.previewCsv(this.csvText);
            this.csvPreview.set(res.data);
        } catch (e) {
            console.error('Reading the CSV failed', e);
            this.notify.error('admin.audience.contacts.csv_failed');
        } finally {
            this.busy.set(false);
        }
    }

    async importCsv(): Promise<void> {
        const preview = this.csvPreview();
        if (!preview || !this.importListId) { this.notify.error('admin.audience.contacts.pick_list'); return; }
        this.busy.set(true);
        try {
            const res: any = await this.audience.importContacts(preview.valid, this.importListId, this.importConsent);
            this.notify.success('admin.audience.contacts.imported', { count: res?.data?.imported || 0 });
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error('Importing contacts failed', e);
            this.notify.error('admin.audience.contacts.import_failed');
        } finally {
            this.busy.set(false);
        }
    }

    /**
     * Confirm, then erase. The dialog spells out what disappears because the
     * action reaches past the contact into the form's member list — an admin who
     * expects "remove from this table" would otherwise lose signup records too.
     */
    confirmErase(): void {
        const c = this.contact;
        if (!c?.id) return;
        // The address is user-supplied and goes into the dialog's HTML, so it is escaped.
        const msg = this.transloco.translate('admin.audience.contacts.erase_confirm', { email: escapeHtml(c.email || '') });

        this.dialog.open(ConfirmationPopupComponent, {
            width: '400px',
            maxWidth: '92vw',
            data: {
                titleKey: 'admin.audience.contacts.erase',
                dialogMessage: msg,
                btnText: this.transloco.translate('admin.audience.contacts.erase_button'),
                panelType: 'warn',
            },
        }).afterClosed().subscribe(async (confirmed: boolean) => {
            if (!confirmed) return;
            await this.erase();
        });
    }

    private async erase(): Promise<void> {
        const c = this.contact;
        if (!c?.id) return;
        this.busy.set(true);
        try {
            await this.audience.deleteContact(c.id);
            this.notify.success('admin.audience.contacts.erased');
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error('Erasing the contact failed', e);
            this.notify.error('admin.audience.contacts.erase_failed');
        } finally {
            this.busy.set(false);
        }
    }

    async setConsent(marketing: MarketingConsent): Promise<void> {
        const c = this.contact;
        if (!c?.id) return;
        this.busy.set(true);
        try {
            await this.audience.setConsent(c.id, marketing);
            this.notify.success('admin.audience.contacts.consent_set', { consent: audienceStatusText(this.transloco, marketing) });
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error('Changing consent failed', e);
            this.notify.error('admin.audience.contacts.consent_failed');
        } finally {
            this.busy.set(false);
        }
    }
}
