import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { AudienceService } from '../(audience)/audience.service';
import { IContactField, fieldKeyFromLabel } from '../(audience)/audience.model';

/**
 * Custom contact fields (U4.5).
 *
 * An account-level registry, so two forms collecting "company" populate the same
 * field on the contact rather than two unrelated ones — which is what makes a
 * merge tag work in a send to any list.
 */
@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule,
        MatFormFieldModule, MatSelectModule, MatTooltipModule, MatDialogModule,
        MatSidenavModule, GlobalTableComponent, PageHeaderComponent,
    ],
    templateUrl: './contact-fields.page.html',
    styleUrls: ['./contact-fields.page.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class ContactFieldsPageComponent implements OnInit {
    private audience = inject(AudienceService);
    private toast = inject(ToastService);
    private dialog = inject(MatDialog);
    private sanitizer = inject(DomSanitizer);
    private destroyRef = inject(DestroyRef);

    fields = signal<IContactField[]>([]);
    loading = signal(true);
    busy = signal(false);

    // Drawer state
    editing = signal<IContactField | null>(null);
    drawerOpen = signal(false);
    label = '';
    type: IContactField['type'] = 'text';
    writePolicy: 'fill' | 'overwrite' = 'fill';
    defaultValue = '';
    optionsText = '';

    columns: TableColumn[] = [
        { key: 'label', header: 'Field', type: 'text', classFn: () => 'fw-medium' },
        {
            key: 'key', header: 'Merge tag', type: 'code', classFn: () => 'small',
            transformFn: (r) => `##FIELD:${r.key}##`,
        },
        { key: 'type', header: 'Type', type: 'text', classFn: () => 'small text-muted' },
        {
            key: 'writePolicy', header: 'On re-submit', type: 'text', classFn: () => 'small',
            transformFn: (r) => (r.writePolicy === 'overwrite' ? 'Overwrite' : 'Keep existing'),
        },
        {
            key: 'defaultValue', header: 'Fallback', type: 'text', classFn: () => 'small text-muted',
            transformFn: (r) => r.defaultValue || '—',
        },
        {
            key: 'actions', header: 'Actions', type: 'actions',
            actions: [
                {
                    action: 'edit', icon: 'fas fa-pen text-primary', label: 'Edit', class: 'edit',
                    isRowClick: true, onAction: (row) => this.openEdit(row),
                },
                {
                    action: 'delete', icon: 'fas fa-trash text-danger', label: 'Delete', class: 'delete',
                    onAction: (row) => this.confirmDelete(row),
                },
            ],
        },
    ];

    /** Shown while adding so the admin sees the key (and tag) their label produces. */
    previewKey(): string {
        return this.editing()?.key || fieldKeyFromLabel(this.label);
    }

    ngOnInit(): void {
        this.audience.getFields().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((f) => {
            this.fields.set(f);
            this.loading.set(false);
        });
    }

    openAdd(): void {
        this.editing.set(null);
        this.label = '';
        this.type = 'text';
        this.writePolicy = 'fill';
        this.defaultValue = '';
        this.optionsText = '';
        this.drawerOpen.set(true);
    }

    openEdit(field: IContactField): void {
        this.editing.set(field);
        this.label = field.label;
        this.type = field.type;
        this.writePolicy = field.writePolicy || 'fill';
        this.defaultValue = field.defaultValue || '';
        this.optionsText = (field.options || []).join(', ');
        this.drawerOpen.set(true);
    }

    closeDrawer(): void {
        this.drawerOpen.set(false);
        this.editing.set(null);
    }

    async save(): Promise<void> {
        const label = this.label.trim();
        if (!this.previewKey()) {
            this.toast.error('The label needs at least one letter or number');
            return;
        }
        this.busy.set(true);
        try {
            await this.audience.upsertField({
                key: this.editing()?.key,
                label,
                type: this.type,
                writePolicy: this.writePolicy,
                defaultValue: this.defaultValue.trim() || undefined,
                options: this.type === 'select'
                    ? this.optionsText.split(',').map((o) => o.trim()).filter(Boolean)
                    : undefined,
            });
            this.toast.success(this.editing() ? 'Field updated' : 'Field created');
            this.closeDrawer();
        } catch (e: any) {
            console.error(e);
            // Surface the server's reason — reserved keys are rejected by name.
            this.toast.error(e?.message || 'Failed to save the field');
        } finally {
            this.busy.set(false);
        }
    }

    confirmDelete(field: IContactField): void {
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Delete the <strong>${this.escape(field.label)}</strong> field?<br><br>`
            + `Values already collected stay on contacts, so re-adding the field brings them back. `
            + `Templates using <code>##FIELD:${this.escape(field.key)}##</code> will fall back to their default.`,
        );
        this.dialog.open(ConfirmationPopupComponent, {
            width: '400px',
            data: { dialogType: 'Delete', dialogMessage: msg, btnText: 'Delete', panelType: 'warn' },
        }).afterClosed().subscribe(async (ok: boolean) => {
            if (!ok) return;
            try {
                await this.audience.deleteField(field.key);
                this.toast.success('Field deleted');
            } catch (e) {
                console.error(e);
                this.toast.error('Failed to delete the field');
            }
        });
    }

    /** Lift historical form submissions onto contact fields. Safe to re-run. */
    async runMigration(): Promise<void> {
        this.busy.set(true);
        try {
            const res: any = await this.audience.migrateFormDataToContactFields();
            const d = res?.data || {};
            let msg = `Mapped ${d.valuesWritten || 0} values onto ${d.contactsUpdated || 0} contacts`;
            if (d.conflicts?.length) msg += ` · ${d.conflicts.length} conflict(s) logged`;
            if (d.unmappedForms?.length) msg += ` · ${d.unmappedForms.length} form(s) have no field mapping`;
            this.toast.success(msg);
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to import form data');
        } finally {
            this.busy.set(false);
        }
    }

    private escape(value: string): string {
        return (value || '').replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
        ));
    }
}
