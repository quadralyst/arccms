/**
 * A message on screen that follows the page's language (F52).
 *
 * A sentence kept as finished text (`error.set(this.t('...'))`) stays in the language it
 * was said in when the person changes the page's. A live text keeps how to say it instead,
 * and says it again once the new language's strings are in:
 *
 *   readonly error = injectLiveText();
 *   ...
 *   this.error.set(() => this.t('member.auth.enter_code'));
 *   this.error.set(readSignInError(err).say);   // a server refusal, with its numbers
 *   this.error.set('');                          // nothing to say
 *
 * Read it as a signal, `error()`, in the template and in code. Text that is nobody's to
 * translate (a person's own words, a provider's message) is set as a plain string.
 *
 * Spec: docs/features/languages.html
 */
import { Injectable, Signal, computed, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { EMPTY, catchError, scan, switchMap } from 'rxjs';

/** What a message says: finished text, or how to say it in the language the page shows. */
export type Say = string | (() => string);

/** The text of a `Say`, in the language the page shows now. */
export function said(say: Say): string {
    return typeof say === 'string' ? say : say();
}

/** When the page's language changes, for text that is built in code. */
@Injectable({ providedIn: 'root' })
export class PageLanguage {
    private readonly transloco = inject(TranslocoService);

    /**
     * Goes up each time the page shows another language, once its strings are in, so a
     * sentence is never said from a file still on its way. Read it in a `computed()`.
     */
    readonly version: Signal<number> = toSignal(
        this.transloco.langChanges$.pipe(
            // A file that cannot be loaded leaves what is on screen as it was.
            switchMap((lang) => this.transloco.load(lang).pipe(catchError(() => EMPTY))),
            scan((n) => n + 1, 0),
        ),
        { initialValue: 0 },
    );
}

export interface LiveText {
    /** What it says, in the language the page shows now; '' for nothing. */
    (): string;
    set(say: Say): void;
    /** How it is said, to show the same message in another place. */
    source(): Say;
}

/** Must be called in an injection context (a field initialiser or constructor). */
export function injectLiveText(): LiveText {
    const language = inject(PageLanguage);
    const source = signal<Say>('');
    const text = computed(() => {
        language.version();
        const say = source();
        // Said again when the language changes, and for nothing else it happens to read.
        return untracked(() => said(say));
    });
    return Object.assign(() => text(), { set: (say: Say) => source.set(say), source: () => source() });
}
