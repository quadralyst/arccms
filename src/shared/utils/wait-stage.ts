/**
 * What a screen says while it waits on the server (docs/app/sign-in.html#waiting): at
 * once that it is working, "Still checking…" after 4 seconds, and after 12 that no
 * answer has come yet. The sign-in page uses it through `<arc-wait-line>`; an app's
 * own screens can too.
 */
import { DestroyRef, effect, inject, Injector, signal, untracked, type Signal } from '@angular/core';

export type WaitStage = 'idle' | 'working' | 'slow' | 'stalled';

/** "Still checking…" from here. */
export const SLOW_AFTER_MS = 4000;
/** "No answer yet" from here. */
export const STALLED_AFTER_MS = 12000;

/** The words for each stage (member.wait.*). */
export const WAIT_WORDS = {
    working: 'member.wait.checking',
    slow: 'member.wait.still_checking',
    stalled: 'member.wait.no_answer',
} as const satisfies Record<Exclude<WaitStage, 'idle'>, string>;

/**
 * Follows `on`: `working` as soon as it turns true, `slow` after SLOW_AFTER_MS,
 * `stalled` after STALLED_AFTER_MS, `idle` as soon as it turns false. Call it in an
 * injection context (a field initializer), or pass an injector.
 */
export function waitStage(on: () => boolean, injector?: Injector): Signal<WaitStage> {
    const at = injector ?? inject(Injector);
    const stage = signal<WaitStage>('idle');
    let timers: ReturnType<typeof setTimeout>[] = [];
    const clear = () => {
        timers.forEach(clearTimeout);
        timers = [];
    };
    effect(() => {
        const waiting = on();
        untracked(() => {
            if (!waiting) {
                clear();
                stage.set('idle');
                return;
            }
            // Already waiting: the clock keeps running from the first moment.
            if (stage() !== 'idle') return;
            stage.set('working');
            timers = [
                setTimeout(() => stage.set('slow'), SLOW_AFTER_MS),
                setTimeout(() => stage.set('stalled'), STALLED_AFTER_MS),
            ];
        });
    }, { injector: at });
    at.get(DestroyRef).onDestroy(clear);
    return stage.asReadonly();
}
