/**
 * `| translatable` — translate it if it is one of our keys, otherwise print it.
 *
 * The same rule the public side has always used for `data-arc-t`: a translation
 * replaces the authored text, and anything without one stands as written. Here
 * it lets one field hold either, which is what table columns need — a heading
 * is `'common.table.name'` when we authored it and `'Author'` when it came from
 * a content type's custom field.
 *
 * Without this, a data heading goes to `| transloco`, finds no such key, and is
 * echoed back with a "missing key" logged on every render.
 *
 * Impure, like Transloco's own pipe, so a language switch re-renders.
 *
 * Spec: docs/i18n-guide.md — §2.4.
 */

import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { TRANSLATION_KEYS, TranslationKey } from './translation-keys';

const KEYS = new Set<string>(TRANSLATION_KEYS);

/** Whether a string is a key in en.json rather than literal text. */
export function isTranslationKey(value: string): value is TranslationKey {
    return KEYS.has(value);
}

@Pipe({
    name: 'translatable',
    standalone: true,
    pure: false,
})
export class TranslatablePipe implements PipeTransform {
    private transloco = inject(TranslocoService);

    transform(value: string | null | undefined, params?: Record<string, unknown>): string {
        if (!value) return '';
        return isTranslationKey(value) ? this.transloco.translate(value, params) : value;
    }
}
