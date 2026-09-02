/**
 * `injectT()` — a translate function with the key checked at compile time.
 *
 * `BaseComponent.t()` covers classes that extend it; plenty do not, and the
 * point of the typed key is lost if the fallback is untyped
 * `transloco.translate()`. Use this in any component or service:
 *
 *   private t = injectT();
 *   ...
 *   this.saveMessage.set(this.t('common.messages.saved'));
 *
 * Call `transloco.translate()` directly only for a key computed at runtime,
 * where a type cannot help.
 *
 * Spec: docs/i18n-guide.md — §2.3.
 */

import { inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { TranslationKey } from './translation-keys';

export type TranslateFn = (key: TranslationKey, params?: Record<string, unknown>) => string;

/** Must be called in an injection context (a field initialiser or constructor). */
export function injectT(): TranslateFn {
    const transloco = inject(TranslocoService);
    return (key, params) => transloco.translate(key, params);
}
