/**
 * `data-arc-t` for Angular component templates.
 *
 * The same annotation the static templates use, so the default layouts in
 * `content-detail/list.component.ts` — which mirror `public/templates/default/*`
 * — translate from the same keys and cannot drift apart per language.
 *
 *   <span data-arc-t="read_more">Read Article</span>
 *
 * The authored English is the fallback: the element is only rewritten once a
 * translation for that key exists.
 *
 * Spec: docs/multilingual-spec.md — Phase M5.1.
 */

import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import { UiStringsService } from '../services/ui-strings.service';

@Directive({
    selector: '[data-arc-t]',
    standalone: true,
})
export class ArcTranslateDirective {
    private element = inject(ElementRef<HTMLElement>);
    private uiStrings = inject(UiStringsService);

    /** Translation key, read from the `data-arc-t` attribute. */
    readonly key = input.required<string>({ alias: 'data-arc-t' });

    /** The authored English, captured before the first replacement. */
    private original: string | null = null;

    constructor() {
        effect(() => {
            const element = this.element.nativeElement as HTMLElement;
            if (this.original === null) {
                this.original = element.textContent ?? '';
            }
            // Restores the English when strings are cleared (switching back to
            // the default language), rather than leaving the last translation.
            element.textContent = this.uiStrings.translate(this.key(), this.original);
        });
    }
}
