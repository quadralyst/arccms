import { ChangeDetectionStrategy, Component, DOCUMENT, computed, inject, input } from '@angular/core';
import { legalNoticeLang, legalNoticeParts } from '../../constants/legal-notice';

/**
 * The signup notice (terms, privacy, marketing email) for the app's own signup
 * pages. Wording and links live in shared/constants/legal-notice.ts.
 */
@Component({
    selector: 'arc-legal-notice',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <p class="legal-notice" data-legal-notice>
            @for (part of parts(); track $index) {
                @if (part.href) {
                    <a [href]="part.href" target="_blank" rel="noopener">{{ part.text }}</a>
                } @else {{{ part.text }}}
            }
        </p>
    `,
    styles: [`
        .legal-notice { font-size: 0.8rem; color: #6c757d; margin: 0.75rem 0 0; line-height: 1.4; text-align: center; }
        .legal-notice a { color: inherit; text-decoration: underline; }
    `],
})
export class LegalNoticeComponent {
    private document = inject(DOCUMENT);
    /** Page language; defaults to the document's `lang`. */
    readonly lang = input<string | undefined>(undefined);
    readonly parts = computed(() =>
        legalNoticeParts(legalNoticeLang(this.lang() ?? this.document.documentElement.lang)));
}
