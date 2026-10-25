/**
 * A fresh code before a sensitive action (F31 part 2, docs/app/fresh-code.html).
 *
 * `confirm({ purpose })` opens Arc CMS's own dialog: it sends the signed-in person a
 * code to their own address (or number), takes it, and resolves with a proof, or null
 * when they cancel. Pass the proof to your callable, which uses it up with
 * useFreshCodeProof() from the app kit. An app that wants its own sheet calls
 * `request()` and `confirmCode()` itself, with `arc-code-input` for the boxes.
 */
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { arcCallable } from '../config/arc-functions';
import { translateRefusal } from '../../pages/(auth)/sign-in.service';

/** What requestFreshCode answered: where the code went, and while testing the code itself. */
export interface FreshCodeSent {
    sent: boolean;
    via: 'email' | 'phone';
    /** The address or number, masked: `a•••@example.com`. */
    to: string;
    alreadySent?: boolean;
    /** Seconds before another code may be asked for. */
    wait?: number;
    testMode?: boolean;
    testCode?: string;
    testCodeInLogs?: boolean;
}

@Injectable({ providedIn: 'root' })
export class FreshCodeService {
    private readonly functions = inject(Functions);
    private readonly injector = inject(Injector);
    private readonly dialog = inject(MatDialog);
    private readonly transloco = inject(TranslocoService);

    /**
     * Asks the signed-in person for a fresh code in Arc CMS's dialog. Resolves with the
     * proof for `purpose` (lower case letters, digits, - and _), or null when cancelled.
     */
    async confirm(options: { purpose: string }): Promise<string | null> {
        const { FreshCodeDialogComponent } = await import('./fresh-code-dialog.component');
        const ref = this.dialog.open(FreshCodeDialogComponent, {
            data: { purpose: options.purpose },
            width: '420px',
            maxWidth: 'calc(100vw - 32px)',
            autoFocus: false,
        });
        return (await firstValueFrom(ref.afterClosed())) ?? null;
    }

    /** Sends the signed-in person a code for `purpose`. */
    request(purpose: string): Promise<FreshCodeSent> {
        return this.call<FreshCodeSent>('requestFreshCode', { purpose, language: this.transloco.getActiveLang() });
    }

    /** Confirms the code: the proof your callable passes to useFreshCodeProof(). */
    async confirmCode(purpose: string, code: string): Promise<string> {
        return (await this.call<{ proof: string }>('confirmFreshCode', { purpose, code })).proof;
    }

    private async call<T>(name: string, data: Record<string, unknown>): Promise<T> {
        try {
            const result = await runInInjectionContext(this.injector, () => arcCallable(this.functions, name)(data));
            return result.data as T;
        } catch (err) {
            // Say a refusal in the member's language, as the sign-in page does.
            const e = err as { message?: string; details?: Record<string, unknown> };
            const text = translateRefusal(e?.details, (key, params) => this.transloco.translate(key, params), this.transloco.getActiveLang());
            if (text && e && typeof e === 'object') {
                try {
                    e.message = text;
                } catch { /* a frozen error keeps the server's text */ }
            }
            throw err;
        }
    }
}
