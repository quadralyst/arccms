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
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ConfirmationPopupComponent } from '../../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { ToastService } from '../../../../../shared/services/toast.service';
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
        MatDialogModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="side-panel">
        <div class="panel-header">
            <h5>
                @switch (mode) {
                    @case ('add') { Add contact }
                    @case ('import') { Import from CSV }
                    @default { Contact }
                }
            </h5>
            <button class="close-btn" (click)="close.emit()"><i class="fas fa-times"></i></button>
        </div>

        <!-- Add -->
        @if (mode === 'add') {
        <div class="flex-grow-1">
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>Email</mat-label>
                <input matInput type="email" [(ngModel)]="newEmail" placeholder="person@example.com" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>Name (optional)</mat-label>
                <input matInput [(ngModel)]="newName" />
            </mat-form-field>
            <mat-checkbox [(ngModel)]="newConsent">I have consent to email them</mat-checkbox>
        </div>
        <div class="panel-actions">
            <button mat-stroked-button (click)="close.emit()">Cancel</button>
            <button mat-flat-button color="primary" [disabled]="busy()" (click)="addContact()">
                <mat-icon>person_add</mat-icon> Add contact
            </button>
        </div>
        }

        <!-- Import -->
        @if (mode === 'import') {
        <div class="flex-grow-1">
            <p class="small text-muted">Paste rows as <code>email,name</code> (a header row is optional).</p>
            <textarea class="form-control mb-2" rows="6" [(ngModel)]="csvText"
                placeholder="email,name&#10;alice&#64;example.com,Alice"></textarea>
            <button mat-stroked-button [disabled]="busy() || !csvText.trim()" (click)="previewCsv()">Preview</button>

            @if (csvPreview(); as p) {
            <div class="mt-3">
                <p class="mb-2">
                    <span class="text-success">{{ p.validCount }} valid</span> ·
                    <span class="text-warning">{{ p.duplicateCount }} duplicate</span> ·
                    <span class="text-danger">{{ p.invalidCount }} invalid</span>
                </p>
                <mat-form-field appearance="outline" class="w-100">
                    <mat-label>Add to list</mat-label>
                    <mat-select [(ngModel)]="importListId">
                        @for (list of lists; track list.id) {
                        <mat-option [value]="list.id">{{ list.name }}</mat-option>
                        }
                    </mat-select>
                </mat-form-field>
                <mat-checkbox [(ngModel)]="importConsent">These contacts have consented to marketing</mat-checkbox>
                <p class="small text-muted mt-2">Without affirming consent, imported contacts are marked
                    <em>pending</em> and excluded from marketing sends.</p>
            </div>
            }
        </div>
        <div class="panel-actions">
            <button mat-stroked-button (click)="close.emit()">Cancel</button>
            @if (csvPreview(); as p) {
            <button mat-flat-button color="primary" [disabled]="busy() || !p.validCount || !importListId" (click)="importCsv()">
                Import {{ p.validCount }} contacts
            </button>
            }
        </div>
        }

        <!-- View + consent -->
        @if (mode === 'view' && contact) {
        <div class="flex-grow-1">
            <dl class="row mb-3">
                <dt class="col-4 text-muted small">Email</dt>
                <dd class="col-8">{{ contact.email }}</dd>
                <dt class="col-4 text-muted small">Name</dt>
                <dd class="col-8">{{ contact.name || '—' }}</dd>
                <dt class="col-4 text-muted small">Sources</dt>
                <dd class="col-8">{{ (contact.sources || []).join(', ') || '—' }}</dd>
                <dt class="col-4 text-muted small">Lists</dt>
                <dd class="col-8">{{ (contact.listIds || []).length }}</dd>
                <dt class="col-4 text-muted small">Consent</dt>
                <dd class="col-8">
                    <span [class]="consentBadge(contact)">{{ contact.consent?.marketing || 'pending' }}</span>
                </dd>
            </dl>

            @if (contact.consent?.marketing === 'pending') {
            <p class="small text-muted mb-3">
                <i class="fas fa-circle-info me-1"></i>
                Signed up but hasn't confirmed their email. They're excluded from marketing sends until they verify.
            </p>
            }

            @if (allFields.length) {
            <label class="form-label small text-muted d-block">Fields</label>
            <div class="mb-3">
                @for (f of allFields; track f.key) {
                    <mat-form-field appearance="outline" class="w-100">
                        <mat-label>{{ f.label }}</mat-label>
                        <input matInput [ngModel]="fieldValues[f.key]"
                            (ngModelChange)="fieldValues[f.key] = $event" [disabled]="busy()" />
                    </mat-form-field>
                }
                <button mat-stroked-button color="primary" [disabled]="busy()" (click)="saveFields()">
                    <mat-icon>save</mat-icon> Save fields
                </button>
            </div>
            }

            <label class="form-label small text-muted d-block">Tags</label>
            @if (allTags.length) {
            <div class="d-flex flex-wrap gap-2 mb-3">
                @for (t of allTags; track t.id) {
                    <button type="button" class="tag-toggle" [class.is-on]="selectedTags.includes(t.id)"
                        [style.background]="selectedTags.includes(t.id) ? t.color : 'transparent'"
                        [style.border-color]="t.color"
                        [style.color]="selectedTags.includes(t.id) ? '#fff' : t.color"
                        [disabled]="busy()" (click)="toggleTag(t.id)">
                        {{ t.label }}
                    </button>
                }
            </div>
            } @else {
            <p class="small text-muted mb-3">No tags yet — create them under Audience → Tags.</p>
            }

            <hr class="my-3" />
            <label class="form-label small text-muted d-block">Erase</label>
            <p class="small text-muted mb-2">
                Deletes this address from the audience, the signup form's member list and any
                pending verification. Use this to honour a deletion request — to just stop
                emailing someone, suppress them instead.
            </p>
            <button mat-stroked-button color="warn" [disabled]="busy()" (click)="confirmErase()">
                <mat-icon>delete_forever</mat-icon> Erase contact
            </button>
        </div>
        <div class="panel-actions">
            @if (contact.consent?.marketing !== 'subscribed') {
            <button mat-stroked-button color="primary" [disabled]="busy()" (click)="setConsent('subscribed')">Subscribe</button>
            }
            @if (contact.consent?.marketing !== 'unsubscribed') {
            <button mat-stroked-button color="warn" [disabled]="busy()" (click)="setConsent('unsubscribed')">Suppress</button>
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
    private toast = inject(ToastService);
    private dialog = inject(MatDialog);
    private sanitizer = inject(DomSanitizer);

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
            this.toast.success('Fields saved');
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to save fields');
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
            console.error(e);
            this.selectedTags = previous;
            this.toast.error('Failed to update tags');
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

    async addContact(): Promise<void> {
        const email = this.newEmail.trim().toLowerCase();
        if (!email.includes('@')) { this.toast.error('Enter a valid email'); return; }
        this.busy.set(true);
        try {
            await this.audience.addContact(email, this.newName.trim(), [], this.newConsent);
            this.toast.success('Contact added');
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to add contact');
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
            console.error(e);
            this.toast.error('Failed to parse CSV');
        } finally {
            this.busy.set(false);
        }
    }

    async importCsv(): Promise<void> {
        const preview = this.csvPreview();
        if (!preview || !this.importListId) { this.toast.error('Pick a list first'); return; }
        this.busy.set(true);
        try {
            const res: any = await this.audience.importContacts(preview.valid, this.importListId, this.importConsent);
            this.toast.success(`Imported ${res?.data?.imported || 0} contacts`);
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error(e);
            this.toast.error('Import failed');
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
        // The address is user-supplied and goes into trusted HTML, so it takes the
        // same escape as the tag label in the Tags page.
        const email = (c.email || '').replace(/[&<>"']/g, (ch) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
        ));
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Permanently erase <strong>${email}</strong>?<br><br>`
            + 'This deletes the contact, its signup form member record and any pending '
            + 'verification. It cannot be undone, and it is not the same as suppressing '
            + 'them — an erased person can sign up again later.',
        );

        this.dialog.open(ConfirmationPopupComponent, {
            width: '400px',
            data: { dialogType: 'Erase contact', dialogMessage: msg, btnText: 'Erase', panelType: 'warn' },
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
            this.toast.success('Contact erased');
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to erase contact');
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
            this.toast.success(`Consent set to ${marketing}`);
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to update consent');
        } finally {
            this.busy.set(false);
        }
    }
}
