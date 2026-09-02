/**
 * Translated toasts.
 *
 * `ToastService` takes a finished string, so every call site had to build one —
 * which meant every call site was a hardcoded English sentence. This wraps it
 * so a call site names a key instead, and picks the conventional icon for the
 * kind of message rather than repeating it 54 times.
 *
 *   this.notify.success('admin.contents.saved');
 *   this.notify.error('admin.contents.delete_failed', { title: content.title });
 *
 * `raw()` is the escape hatch for text that genuinely is not ours to translate
 * — a message from a server, or a content title echoed back.
 *
 * Spec: docs/multilingual-spec.md — Phase M7.
 */

import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { ToastService } from './toast.service';
import { TranslationKey } from '../../app/core/i18n/translation-keys';

type ToastParams = Record<string, unknown>;

@Injectable({ providedIn: 'root' })
export class NotifyService {
    private toast = inject(ToastService);
    private transloco = inject(TranslocoService);

    success(key: TranslationKey, params?: ToastParams): void {
        this.toast.openCustomSnackbar(this.text(key, params), 'success', 'check_circle');
    }

    error(key: TranslationKey, params?: ToastParams): void {
        this.toast.openCustomSnackbar(this.text(key, params), 'error', 'error');
    }

    warning(key: TranslationKey, params?: ToastParams): void {
        this.toast.openCustomSnackbar(this.text(key, params), 'warning', 'warning');
    }

    info(key: TranslationKey, params?: ToastParams): void {
        this.toast.openCustomSnackbar(this.text(key, params), 'info', 'info');
    }

    /** Already-final text — a server message, or a name echoed back. */
    raw(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): void {
        this.toast.openCustomSnackbar(message, type, type === 'success' ? 'check_circle' : type);
    }

    /** Translate a key, or hand back text that clearly is not one. */
    private text(key: TranslationKey, params?: ToastParams): string {
        return this.transloco.translate(key, params);
    }
}
