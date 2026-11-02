/**
 * A new PIN, typed twice: "Your new PIN", then "Type it again", so one typo never
 * locks the person out. Every screen that sets a PIN uses it: the sign-in page's
 * sign-up, Forgot PIN and Choose PIN steps, and the profile's Sign-in methods.
 *
 *     <arc-new-pin #newPinField [masked]="!showPin()" [disabled]="busy()" (completed)="save()" />
 *
 * The second row takes the cursor once the first is full, and `completed` fires on
 * its last digit. The page reads the PIN with `check()`, which says what is missing
 * instead; two rows that differ are emptied there, to start again, and nothing is
 * saved. `restart()` empties both, such as after the server refuses the PIN.
 */
import { ChangeDetectionStrategy, Component, input, output, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CodeInputComponent } from '../code-input/code-input.component';

/** Why `check()` found no PIN to save: the message to show, as a member string. */
export type NewPinProblem = 'member.auth.choose_pin' | 'member.auth.pin_again_needed' | 'member.auth.pins_mismatch';

@Component({
    selector: 'arc-new-pin',
    standalone: true,
    imports: [TranslocoPipe, CodeInputComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="new-pin-label">{{ 'member.auth.your_new_pin' | transloco }}</div>
        <arc-code-input #first [label]="'member.auth.your_new_pin' | transloco" [masked]="masked()" [oneTimeCode]="false"
            [autofocus]="autofocus()" [disabled]="disabled()"
            (changed)="pin.set($event)" (completed)="firstTyped()"></arc-code-input>
        <div class="new-pin-label new-pin-label-again">{{ 'member.auth.pin_again' | transloco }}</div>
        <arc-code-input #again [label]="'member.auth.pin_again' | transloco" [masked]="masked()" [oneTimeCode]="false"
            [autofocus]="false" [disabled]="disabled()"
            (changed)="pinAgain.set($event)" (completed)="completed.emit()"></arc-code-input>
    `,
    // The label colour is the sign-in page's field label (docs/website/sign-in-page.html).
    styles: [`
        :host { display: flex; flex-direction: column; gap: 8px; }
        .new-pin-label {
            font-size: 0.9rem;
            font-weight: 500;
            text-align: center;
            color: var(--arc-sign-in-label-color, inherit);
        }
        .new-pin-label-again { margin-top: 8px; }
    `],
})
export class NewPinInputComponent {
    readonly masked = input(true);
    readonly disabled = input(false);
    /** Put the cursor in the first box when it can take it (off on a step that opens on another field). */
    readonly autofocus = input(true);

    /** The second row's last digit: the page may save. */
    readonly completed = output<void>();
    /** The first row's last digit (the page may clear an old error). */
    readonly firstDone = output<void>();

    /** What each row holds so far. */
    readonly pin = signal('');
    readonly pinAgain = signal('');

    private readonly first = viewChild.required<CodeInputComponent>('first');
    private readonly again = viewChild.required<CodeInputComponent>('again');

    firstTyped(): void {
        this.again().focus(0);
        this.firstDone.emit();
    }

    /**
     * The PIN to save, once both rows hold the same 6 digits. Otherwise why not, with
     * the cursor where the person goes next; two that differ empty both rows first.
     */
    check(): { pin: string } | { problem: NewPinProblem } {
        const pin = this.pin();
        if (pin.length !== 6) {
            this.first().focus(0);
            return { problem: 'member.auth.choose_pin' };
        }
        if (this.pinAgain().length !== 6) {
            this.again().focus(0);
            return { problem: 'member.auth.pin_again_needed' };
        }
        if (this.pinAgain() !== pin) {
            this.restart();
            return { problem: 'member.auth.pins_mismatch' };
        }
        return { pin };
    }

    /** Both rows emptied, the cursor in the first. */
    restart(): void {
        // The first row's reset runs last, so the cursor ends there.
        this.again().reset();
        this.first().reset();
        this.pin.set('');
        this.pinAgain.set('');
    }
}
