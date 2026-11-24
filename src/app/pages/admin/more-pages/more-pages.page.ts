import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ArcTimePipe } from '../../../core/time/arc-time.pipe';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { MorePagesService, type MorePageRow } from './more-pages.service';
import { classicEditorLink, visualEditorLink } from './page-ref';

/**
 * Content, More Pages (specs/visual-editing-spec.md, VE-D48, VE-D65): the home page,
 * then the list page of every type with public pages, then every static page whose file
 * marks something editors can change, each with its address, where it stands and when it
 * was last published.
 */
@Component({
    selector: 'arc-more-pages',
    standalone: true,
    imports: [ArcTimePipe, RouterLink, TranslocoPipe, PageHeaderComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrls: ['./more-pages.page.scss'],
    template: `
        <div class="more-pages">
            <arc-page-header [title]="'admin.more_pages.title' | transloco" [subtitle]="'admin.more_pages.subtitle' | transloco"></arc-page-header>

            @if (loading()) {
                <p class="text-muted" role="status"><i class="fa-solid fa-spinner fa-spin me-2" aria-hidden="true"></i>{{ 'admin.more_pages.loading' | transloco }}</p>
            } @else if (error()) {
                <div class="alert alert-danger d-flex align-items-center gap-3" role="alert">
                    <span>{{ 'admin.more_pages.load_failed' | transloco }}</span>
                    <button type="button" class="btn btn-outline-danger btn-sm" (click)="load()">{{ 'admin.more_pages.retry' | transloco }}</button>
                </div>
            } @else {
                <ul class="page-rows" data-testid="more-pages">
                    @for (row of rows(); track row.pageId) {
                        <li class="page-row" [attr.data-page]="row.pageId">
                            <div class="page-main">
                                <a class="page-name" [routerLink]="editLink(row)">
                                    <i class="fa-solid me-2" [class.fa-house]="row.kind === 'home'" [class.fa-list]="row.kind === 'list'" [class.fa-file-lines]="row.kind === 'static'" aria-hidden="true"></i>
                                    {{ row.kind === 'home' ? ('admin.more_pages.home_page' | transloco) : row.kind === 'list' ? ('admin.more_pages.list_page' | transloco: { type: row.title }) : row.title }}
                                </a>
                                <code class="page-address">{{ row.address }}</code>
                            </div>
                            <span class="page-status" [class]="'page-status status-' + row.status">{{ ('admin.more_pages.status.' + row.status) | transloco }}@if (row.heldBy) { · {{ 'admin.hold.list_held' | transloco: { name: row.heldBy } }} }</span>
                            <span class="page-published text-muted">
                                @if (row.lastPublished) {
                                    {{ 'admin.more_pages.last_published' | transloco }} {{ row.lastPublished | arcTime }}
                                }
                            </span>
                            <span class="page-actions">
                            <a class="btn btn-outline-secondary btn-sm" [routerLink]="visualLink(row)" data-testid="visual-editor">
                                <i class="fa-solid fa-pen-ruler me-1" aria-hidden="true"></i>{{ 'admin.more_pages.visual_editor' | transloco }}
                            </a>
                            <a class="btn btn-outline-primary btn-sm" [routerLink]="editLink(row)">
                                <i class="fa-solid fa-pen me-1" aria-hidden="true"></i>{{ 'admin.more_pages.edit' | transloco }}
                            </a>
                            </span>
                        </li>
                    }
                </ul>
                @if (!hasStatic()) {
                    <p class="text-muted small mt-3">{{ 'admin.more_pages.no_static_pages' | transloco }}</p>
                }
            }
        </div>
    `,
})
export default class MorePagesPage implements OnInit {
    private service = inject(MorePagesService);

    readonly rows = signal<MorePageRow[]>([]);
    readonly hasStatic = computed(() => this.rows().some((row) => row.kind === 'static'));
    readonly loading = signal(true);
    readonly error = signal(false);

    ngOnInit(): void {
        this.load();
    }

    async load(): Promise<void> {
        this.loading.set(true);
        this.error.set(false);
        try {
            this.rows.set(await this.service.list());
        } catch (error) {
            console.error('[MorePages] Could not list the pages:', error);
            this.error.set(true);
        } finally {
            this.loading.set(false);
        }
    }

    /** The Visual Editor of a page (VE-D49). */
    visualLink(row: MorePageRow): string[] {
        return visualEditorLink(row);
    }

    /** The classic editor of a page (VE-D49). */
    editLink(row: MorePageRow): string[] {
        return classicEditorLink(row);
    }
}
