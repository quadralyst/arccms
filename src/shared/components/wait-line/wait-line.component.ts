/**
 * The line that says a screen is waiting on the server (docs/app/sign-in.html#waiting):
 * a small spinner and "Checking…" at once, "Still checking…" after 4 seconds, and after
 * 12 "No answer yet". Nothing while `waiting` is false.
 *
 *     <arc-wait-line [waiting]="saving()" />
 *
 * `words` says something else for the whole wait, such as "Opening…" once a sign-in
 * went through. Said politely to a screen reader.
 */
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { WAIT_WORDS, waitStage } from '../../utils/wait-stage';

@Component({
    selector: 'arc-wait-line',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <p class="wait-line" role="status" [class.stalled]="stage() === 'stalled'">
            @if (key(); as words) {
            <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
            <span>{{ words | transloco }}</span>
            }
        </p>
    `,
    styles: [`
        :host { display: block; }
        .wait-line {
            display: flex; align-items: center; justify-content: center; gap: 0.5rem;
            margin: 0; font-size: 0.875rem; text-align: center;
            color: var(--arc-sign-in-muted-color, #6c757d);
        }
        /* Empty, it takes no room: the line is there from the start so a screen reader hears it change. */
        .wait-line:not(:empty) { margin-top: 0.75rem; }
        .wait-line .spinner-border { flex: none; width: 0.9rem; height: 0.9rem; border-width: 0.15em; }
        .wait-line.stalled { color: var(--arc-sign-in-text-color, #212529); }
    `],
})
export class WaitLineComponent {
    /** Waiting on the server. */
    readonly waiting = input(false);
    /** A key to say for the whole wait instead of the stage's words. */
    readonly words = input('');

    readonly stage = waitStage(() => this.waiting());
    readonly key = computed(() => {
        const stage = this.stage();
        if (stage === 'idle') return '';
        return this.words() || WAIT_WORDS[stage];
    });
}
