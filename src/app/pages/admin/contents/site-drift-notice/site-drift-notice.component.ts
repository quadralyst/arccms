import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NO_LIVE_SITE_FILES, SiteDriftService } from '../../../../core/site/site-drift';

/**
 * Says, beside Publish, when the site files on this computer differ from the live
 * site's, which publishing uses (src/app/core/site/site-drift.ts). Shows nothing
 * when they match and outside `npm run dev`. `compact` fits a toolbar: a short
 * label, with the full message and the files on hover.
 */
@Component({
    selector: 'arc-site-drift-notice',
    standalone: true,
    imports: [TranslocoPipe],
    template: `
        @if (files().length) {
            <span class="site-drift-notice" role="status" [class.compact]="compact()"
                [title]="(message() | transloco) + ' ' + ('admin.contents.site_drift.files' | transloco: { files: files().join(', ') })">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <span>{{ (compact() ? 'admin.contents.site_drift.label' : message()) | transloco }}</span>
            </span>
        }
    `,
    styles: [`
        :host { display: contents; }
        .site-drift-notice {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.35rem 0.75rem;
            border-radius: 6px;
            background: #fff8e1;
            color: #8a5a00;
            font-size: 0.85rem;
            line-height: 1.3;
        }
        .site-drift-notice:not(.compact) { margin-bottom: 1rem; }
        .site-drift-notice.compact { margin-right: 0.5rem; white-space: nowrap; cursor: help; }
    `],
})
export class SiteDriftNoticeComponent implements OnInit {
    /** A short label for a toolbar instead of the whole message. */
    compact = input(false);

    /** The served paths that differ from the live site. */
    files = signal<string[]>([]);

    private drift = inject(SiteDriftService);

    message = computed(() => (this.files().length === 1 && this.files()[0] === NO_LIVE_SITE_FILES
        ? 'admin.contents.site_drift.missing'
        : 'admin.contents.site_drift.message'));

    async ngOnInit(): Promise<void> {
        this.files.set(await this.drift.differences());
    }
}
