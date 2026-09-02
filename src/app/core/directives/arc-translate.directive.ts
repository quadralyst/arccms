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
import { interpolate } from '../i18n/interpolate';

@Directive({
    selector: '[data-arc-t]',
    standalone: true,
})
export class ArcTranslateDirective {
    private element = inject(ElementRef<HTMLElement>);
    private uiStrings = inject(UiStringsService);

    /** Translation key, read from the `data-arc-t` attribute. */
    readonly key = input.required<string>({ alias: 'data-arc-t' });

    /**
     * Values for `{{ }}` placeholders inside the translated string.
     *
     * A translation may carry interpolation — `"वापस {{ contentType }} पर"` —
     * and the same JSON serves both renderers. The static pipeline resolves
     * those tokens by hydrating the template afterwards; Angular cannot
     * re-interpolate a string produced at runtime, so the directive
     * substitutes them itself from this map. Both therefore read the same
     * placeholder names, and one strings file covers both.
     */
    readonly params = input<Record<string, unknown> | undefined>(undefined, {
        alias: 'data-arc-t-params',
    });

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
            const text = this.uiStrings.translate(this.key(), this.original);
            element.textContent = interpolate(text, this.params());
        });
    }
}

/**
 * `data-arc-t-attr` for Angular component templates — the attribute-translating
 * half of the same annotation, so the two shared partials can translate a
 * placeholder or a title the way `public/templates/**` already can.
 *
 *   <input data-arc-t-attr="placeholder:search_placeholder" placeholder="Search">
 *
 * A separate directive rather than a second input on the one above, because an
 * element may carry either annotation without the other.
 */
@Directive({
    selector: '[data-arc-t-attr]',
    standalone: true,
})
export class ArcTranslateAttrDirective {
    private element = inject(ElementRef<HTMLElement>);
    private uiStrings = inject(UiStringsService);

    /** `"placeholder:key"`, or several comma-separated. */
    readonly spec = input.required<string>({ alias: 'data-arc-t-attr' });

    readonly params = input<Record<string, unknown> | undefined>(undefined, {
        alias: 'data-arc-t-params',
    });

    /** The authored values, captured per attribute before the first rewrite. */
    private original = new Map<string, string>();

    constructor() {
        effect(() => {
            const element = this.element.nativeElement as HTMLElement;
            for (const pair of this.spec().split(',')) {
                const [attr, key] = pair.split(':').map(part => part.trim());
                if (!attr || !key) continue;
                if (!this.original.has(attr)) {
                    this.original.set(attr, element.getAttribute(attr) ?? '');
                }
                const authored = this.original.get(attr) ?? '';
                // Same fallback as the text directive: the authored value
                // stands until a translation for that key exists.
                const text = this.uiStrings.translate(key, authored);
                element.setAttribute(attr, interpolate(text, this.params()));
            }
        });
    }
}
