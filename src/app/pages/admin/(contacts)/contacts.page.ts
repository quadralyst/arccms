import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { AudienceService } from '../(audience)/audience.service';
import { IContact, IList, ICsvPreview, MarketingConsent } from '../(audience)/audience.model';

export const routeMeta: RouteMeta = {
    title: 'Contacts | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule,
        MatInputModule, MatFormFieldModule, MatSelectModule, MatCheckboxModule,
    ],
    templateUrl: './contacts.page.html',
})
export default class ContactsPageComponent implements OnInit {
    private audience = inject(AudienceService);
    private toast = inject(ToastService);

    contacts = signal<IContact[]>([]);
    lists = signal<IList[]>([]);
    search = signal('');
    busy = signal(false);

    filtered = computed(() => {
        const term = this.search().trim().toLowerCase();
        if (!term) return this.contacts();
        return this.contacts().filter(
            (c) => c.email?.toLowerCase().includes(term) || c.name?.toLowerCase().includes(term),
        );
    });

    // Add-contact form
    newEmail = '';
    newName = '';
    newConsent = false;

    // CSV import
    csvText = '';
    csvPreview = signal<ICsvPreview | null>(null);
    importListId = '';
    importConsent = false;

    ngOnInit(): void {
        this.audience.getContacts().pipe(takeUntilDestroyed()).subscribe((c) => this.contacts.set(c));
        this.audience.getLists().pipe(takeUntilDestroyed()).subscribe((l) => this.lists.set(l));
    }

    consentClass(c: IContact): string {
        const m = c.consent?.marketing;
        return m === 'subscribed' ? 'text-success' : m === 'unsubscribed' ? 'text-danger' : 'text-warning';
    }

    async setConsent(c: IContact, marketing: MarketingConsent): Promise<void> {
        if (!c.id) return;
        try {
            await this.audience.setConsent(c.id, marketing);
            this.toast.success(`Consent set to ${marketing}`);
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to update consent');
        }
    }

    async addContact(): Promise<void> {
        const email = this.newEmail.trim().toLowerCase();
        if (!email.includes('@')) { this.toast.error('Enter a valid email'); return; }
        this.busy.set(true);
        try {
            await this.audience.addContact(email, this.newName.trim(), [], this.newConsent);
            this.newEmail = ''; this.newName = ''; this.newConsent = false;
            this.toast.success('Contact added');
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to add contact');
        } finally {
            this.busy.set(false);
        }
    }

    async runBackfill(): Promise<void> {
        this.busy.set(true);
        try {
            const res: any = await this.audience.backfillContacts();
            const d = res?.data || {};
            this.toast.success(`Backfill done: ${d.users || 0} users, ${d.waitlistMembers || 0} waitlist`);
        } catch (e) {
            console.error(e);
            this.toast.error('Backfill failed');
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
            this.csvText = ''; this.csvPreview.set(null); this.importConsent = false;
        } catch (e) {
            console.error(e);
            this.toast.error('Import failed');
        } finally {
            this.busy.set(false);
        }
    }
}
