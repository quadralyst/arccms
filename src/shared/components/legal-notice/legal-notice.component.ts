import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { APP_NOTICES, legalNoticeWithPages, signupNoticeParts } from '../../constants/legal-notice';
import { SitePagesService } from '../../../app/core/site/site-pages.service';
import { LocalizationService } from '../../../app/core/services/localization.service';

/**
 * The signup notice (terms, privacy, marketing email) for the app's own signup
 * pages: the app's own text when src/custom/notices.ts has one for the page,
 * else Arc CMS's (shared/constants/legal-notice.ts).
 */
@Component({
    selector: 'arc-legal-notice',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <p class="legal-notice arc-legal-notice" data-legal-notice>
            @for (part of parts(); track $index) {
                @if (part.href) {
                    <a [href]="part.href" target="_blank" rel="noopener">{{ part.text }}</a>
                } @else {{{ part.text }}}
            }
        </p>
    `,
    styles: [`
        .legal-notice {
            font-size: var(--arc-notice-font-size, 0.8rem); color: var(--arc-sign-in-muted-color, #6c757d);
            margin: 0.75rem 0 0; line-height: var(--arc-notice-line-height, 1.4); text-align: center;
        }
        .legal-notice a { color: var(--arc-notice-link-color, inherit); text-decoration: var(--arc-notice-link-decoration, underline); }
    `],
})
export class LegalNoticeComponent {
    private transloco = inject(TranslocoService);
    /** The language the page is shown in, the member's choice on the sign-up page. */
    private pageLang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
    /** Page language; defaults to the language the page is shown in. */
    readonly lang = input<string | undefined>(undefined);
    /** The published standard pages, so the links go to /info/terms when there is one (SS6). */
    private sitePages = inject(SitePagesService);
    /** The site's default language, the app's text to fall back on when it lacks the page's. */
    private localization = inject(LocalizationService);
    readonly parts = computed(() =>
        signupNoticeParts(this.lang() ?? this.pageLang(), legalNoticeWithPages(this.sitePages.pages()), {
            defaultLang: this.localization.known()?.defaultLanguage,
        }));

    constructor() {
        void this.sitePages.load();
        // Only an app with its own notices needs the default language; Arc CMS's own notice does not.
        if (Object.values(APP_NOTICES).some((texts) => texts && Object.keys(texts).length)) void this.localization.load();
    }
}
