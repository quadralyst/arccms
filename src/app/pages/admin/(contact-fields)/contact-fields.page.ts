import { CommonModule } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule } from '@angular/material/dialog';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { injectT } from '../../../core/i18n/inject-t';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { NotifyService } from '../../../../shared/services/notify.service';
import { escapeHtml } from '../../../../shared/utils/escape-html';
import { AudienceService } from '../(audience)/audience.service';
import { IContactField, fieldKeyFromLabel } from '../(audience)/audience.model';

/** Field types with a translated name (admin.audience.fields.type_*). */
const FIELD_TYPES: string[] = ['text', 'number', 'date', 'boolean', 'select'];

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
        MatSidenavModule, GlobalTableComponent, PageHeaderComponent, TranslocoPipe,
    ],
    templateUrl: './contact-fields.page.html',
    styleUrls: ['./contact-fields.page.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class ContactFieldsPageComponent implements OnInit {
    private audience = inject(AudienceService);
    private notify = inject(NotifyService);
    private confirm = inject(ConfirmService);
    private transloco = inject(TranslocoService);
    private t = injectT();
    private destroyRef = inject(DestroyRef);

    fields = signal<IContactField[]>([]);
    loading = signal(true);
    /** The fields did not load; the table shows it with Retry. */
    loadError = signal(false);
    busy = signal(false);
    private loadSub?: { unsubscribe(): void };

    // Drawer state
    editing = signal<IContactField | null>(null);
    drawerOpen = signal(false);
    label = '';
    type: IContactField['type'] = 'text';
    writePolicy: 'fill' | 'overwrite' = 'fill';
    defaultValue = '';
    optionsText = '';

    columns: TableColumn[] = [
        { key: 'label', header: 'admin.audience.fields.field', type: 'text', classFn: () => 'fw-medium' },
        {
            key: 'key', header: 'admin.audience.fields.merge_tag', type: 'code', classFn: () => 'small',
            transformFn: (r) => `##FIELD:${r.key}##`,
        },
        {
            key: 'type', header: 'common.table.type', type: 'text', classFn: () => 'small text-muted',
            transformFn: (r) => (FIELD_TYPES.includes(r.type) ? this.transloco.translate(`admin.audience.fields.type_${r.type}`) : r.type),
        },
        {
            key: 'writePolicy', header: 'admin.audience.fields.on_resubmit', type: 'text', classFn: () => 'small',
            transformFn: (r) => this.t(r.writePolicy === 'overwrite' ? 'admin.audience.fields.policy_overwrite_short' : 'admin.audience.fields.policy_fill_short'),
        },
        {
            key: 'defaultValue', header: 'admin.audience.fields.fallback', type: 'text', classFn: () => 'small text-muted',
            transformFn: (r) => r.defaultValue || '-',
        },
        {
            key: 'actions', header: 'common.table.actions', type: 'actions',
            actions: [
                {
                    action: 'edit', icon: 'fas fa-pen text-primary', label: 'common.actions.edit', class: 'edit',
                    isRowClick: true, onAction: (row) => this.openEdit(row),
                },
                {
                    action: 'delete', icon: 'fas fa-trash text-danger', label: 'common.actions.delete', class: 'delete',
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
        this.load();
    }

    /** Listen to the field registry; called again by Retry. */
    load(): void {
        this.loadSub?.unsubscribe();
        this.loading.set(true);
        this.loadError.set(false);
        let failed = false;
        this.loadSub = this.audience.getFields(() => { failed = true; })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((f) => {
                this.fields.set(f);
                this.loadError.set(failed);
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
            this.notify.error('admin.audience.fields.label_invalid');
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
            this.notify.success(this.editing() ? 'admin.audience.fields.updated' : 'admin.audience.fields.created');
            this.closeDrawer();
        } catch (e: any) {
            console.error('Saving the field failed', e);
            // The server refuses a key it keeps for itself (invalid-argument); say so plainly.
            this.notify.error(String(e?.code ?? '').endsWith('invalid-argument')
                ? 'admin.audience.fields.key_reserved'
                : 'admin.audience.fields.save_failed');
        } finally {
            this.busy.set(false);
        }
    }

    async confirmDelete(field: IContactField): Promise<void> {
        const ok = await this.confirm.ask({
            titleKey: 'common.dialog.delete',
            dialogMessage: this.t('admin.audience.fields.delete_confirm', { name: escapeHtml(field.label), key: escapeHtml(field.key) }),
            btnText: this.t('common.actions.delete'),
            panelType: 'warn',
        }, '400px');
        if (!ok) return;
        try {
            await this.audience.deleteField(field.key);
            this.notify.success('admin.audience.fields.deleted');
        } catch (e) {
            console.error('Deleting the field failed', e);
            this.notify.error('admin.audience.fields.delete_failed');
        }
    }

    /** Lift historical form submissions onto contact fields. Safe to re-run. */
    async runMigration(): Promise<void> {
        this.busy.set(true);
        try {
            const res: any = await this.audience.migrateFormDataToContactFields();
            const d = res?.data || {};
            let msg = this.t('admin.audience.fields.migrated', { values: d.valuesWritten || 0, contacts: d.contactsUpdated || 0 });
            if (d.conflicts?.length) msg += ` ${this.t('admin.audience.fields.migrated_conflicts', { count: d.conflicts.length })}`;
            if (d.unmappedForms?.length) msg += ` ${this.t('admin.audience.fields.migrated_unmapped', { count: d.unmappedForms.length })}`;
            this.notify.raw(msg, 'success');
        } catch (e) {
            console.error('Importing form data failed', e);
            this.notify.error('admin.audience.fields.migrate_failed');
        } finally {
            this.busy.set(false);
        }
    }
}
