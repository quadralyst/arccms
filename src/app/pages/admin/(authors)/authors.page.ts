import { CommonModule } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSidenavModule } from '@angular/material/sidenav';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { injectT } from '../../../core/i18n/inject-t';
import { AuthorsService } from './authors.service';
import { IAuthor, IAuthorData, EMPTY_AUTHOR } from '../../../../shared/models/author.model';

/**
 * Authors (docs/discoverability-spec.md, D2).
 *
 * The people named on bylines and in each page's Article JSON-LD. One of
 * them can be the default, pre-filled on new content.
 */
@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule,
        MatFormFieldModule, MatTooltipModule, MatDialogModule, MatSidenavModule,
        GlobalTableComponent, PageHeaderComponent, TranslocoPipe,
    ],
    templateUrl: './authors.page.html',
    styleUrls: ['./authors.page.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class AuthorsPageComponent implements OnInit {
    private authorsService = inject(AuthorsService);
    private toast = inject(ToastService);
    private dialog = inject(MatDialog);
    private sanitizer = inject(DomSanitizer);
    private destroyRef = inject(DestroyRef);
    private t = injectT();

    authors = signal<IAuthor[]>([]);
    defaultAuthorId = signal('');
    loading = signal(true);
    busy = signal(false);

    /** Rows for the table: the author plus whether it is the default. */
    rows = computed(() =>
        this.authors().map(author => ({ ...author, isDefault: author.id === this.defaultAuthorId() })),
    );

    // Drawer state
    editing = signal<IAuthor | null>(null);
    drawerOpen = signal(false);
    form: IAuthorData = { ...EMPTY_AUTHOR };
    sameAsText = '';

    columns: TableColumn[] = [
        {
            key: 'photoUrl', header: '', type: 'image',
            imageConfig: { height: 36, altKey: 'name' },
        },
        { key: 'name', header: 'admin.contents.authors.col_name', type: 'text', classFn: () => 'fw-medium' },
        { key: 'jobTitle', header: 'admin.contents.authors.col_job_title', type: 'text', classFn: () => 'small text-muted' },
        {
            key: 'isDefault', header: 'admin.contents.authors.col_default', type: 'badge',
            // textFn rather than the true/false pair: the pair's empty false
            // text falls back to the table's generic "Inactive", which reads
            // as a status the author does not have.
            badgeConfig: { textFn: (r) => (r.isDefault ? 'Default' : '') },
            classFn: (r) => (r.isDefault ? 'badge-default' : 'badge-none'),
        },
        {
            key: 'actions', header: 'common.table.actions', type: 'actions',
            actions: [
                {
                    action: 'edit', icon: 'fas fa-pen text-primary', label: 'common.actions.edit', class: 'edit',
                    isRowClick: true, onAction: (row) => this.openEdit(row),
                },
                {
                    action: 'default', icon: 'fas fa-star text-warning', label: 'admin.contents.authors.set_default', class: 'default',
                    onAction: (row) => this.toggleDefault(row),
                },
                {
                    action: 'delete', icon: 'fas fa-trash text-danger', label: 'common.actions.delete', class: 'delete',
                    onAction: (row) => this.confirmDelete(row),
                },
            ],
        },
    ];

    ngOnInit(): void {
        // Seeds the admin as the first author on an empty site (the live list
        // below picks the document up as soon as it is written), then reads
        // the default, which the seed may just have set.
        this.authorsService.ensureAdminAuthor()
            .then(seeded => this.authorsService.loadSettings()
                .then(settings => this.defaultAuthorId.set(settings.defaultAuthorId || seeded?.id || '')));
        this.authorsService.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: authors => {
                this.authors.set(authors);
                this.loading.set(false);
            },
            error: e => {
                // Typically the rules are not deployed yet; an endless spinner hides that.
                console.error('Error loading authors:', e);
                this.loading.set(false);
                this.toast.error(this.t('admin.contents.authors.load_failed'));
            },
        });
    }

    openAdd(): void {
        this.editing.set(null);
        this.form = { ...EMPTY_AUTHOR, sameAs: [] };
        this.sameAsText = '';
        this.drawerOpen.set(true);
    }

    openEdit(author: IAuthor): void {
        this.editing.set(author);
        this.form = {
            name: author.name || '',
            slug: author.slug || '',
            bio: author.bio || '',
            photoUrl: author.photoUrl || '',
            jobTitle: author.jobTitle || '',
            url: author.url || '',
            sameAs: [...(author.sameAs || [])],
        };
        this.sameAsText = (author.sameAs || []).join('\n');
        this.drawerOpen.set(true);
    }

    closeDrawer(): void {
        this.drawerOpen.set(false);
        this.editing.set(null);
    }

    async save(): Promise<void> {
        if (!this.form.name.trim()) {
            this.toast.error(this.t('admin.contents.authors.name_required'));
            return;
        }
        this.busy.set(true);
        const input: Partial<IAuthorData> = {
            ...this.form,
            sameAs: this.sameAsText.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean),
        };
        try {
            const editing = this.editing();
            if (editing) {
                await this.authorsService.save(editing.id, input);
                this.toast.success(this.t('admin.contents.authors.updated'));
            } else {
                // Decided before the write: the live list echoes the new
                // document before create() resolves, so checking afterwards
                // would never see an empty list.
                const wasFirst = !this.defaultAuthorId() && this.authors().length === 0;
                const id = await this.authorsService.create(input);
                // The first author becomes the default: a site with one writer
                // should not have to make that choice explicitly.
                if (wasFirst) {
                    await this.authorsService.setDefaultAuthor(id);
                    this.defaultAuthorId.set(id);
                }
                this.toast.success(this.t('admin.contents.authors.created'));
            }
            this.closeDrawer();
        } catch (e: any) {
            console.error(e);
            this.toast.error(this.t('admin.contents.authors.save_failed'));
        } finally {
            this.busy.set(false);
        }
    }

    async toggleDefault(author: IAuthor): Promise<void> {
        const next = this.defaultAuthorId() === author.id ? '' : author.id;
        try {
            await this.authorsService.setDefaultAuthor(next);
            this.defaultAuthorId.set(next);
            this.toast.success(this.t('admin.contents.authors.default_set'));
        } catch (e) {
            console.error(e);
            this.toast.error(this.t('admin.contents.authors.save_failed'));
        }
    }

    confirmDelete(author: IAuthor): void {
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            this.t('admin.contents.authors.delete_confirm', { name: this.escape(author.name) }),
        );
        this.dialog.open(ConfirmationPopupComponent, {
            width: '400px',
            data: { dialogType: 'Delete', dialogMessage: msg, btnText: 'Delete', panelType: 'warn' },
        }).afterClosed().subscribe(async (ok: boolean) => {
            if (!ok) return;
            try {
                await this.authorsService.remove(author.id);
                if (this.defaultAuthorId() === author.id) {
                    await this.authorsService.setDefaultAuthor('');
                    this.defaultAuthorId.set('');
                }
                this.toast.success(this.t('admin.contents.authors.deleted'));
            } catch (e) {
                console.error(e);
                this.toast.error(this.t('admin.contents.authors.delete_failed'));
            }
        });
    }

    private escape(value: string): string {
        return (value || '').replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
        ));
    }
}
