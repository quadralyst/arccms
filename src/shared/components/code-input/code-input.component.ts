import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    afterNextRender,
    computed,
    input,
    output,
    signal,
    viewChildren,
} from '@angular/core';
import { extractCode } from '../../utils/identifier.util';

/**
 * A row of single-digit boxes for a one-time code or a PIN.
 *
 * Typing moves to the next box, Backspace moves back. Pasting anywhere (or the
 * phone offering the code from an SMS) fills every box, even from a whole
 * message like "Your code is 482913". `completed` fires as soon as the last
 * digit is in, so the page can verify without a button press.
 */
@Component({
    selector: 'arc-code-input',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="code-boxes" role="group" [attr.aria-label]="label()">
            @for (digit of digits(); track $index) {
                <input #box
                    class="code-box"
                    [class.is-invalid]="invalid()"
                    [type]="masked() ? 'password' : 'text'"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    [attr.autocomplete]="$index === 0 && oneTimeCode() ? 'one-time-code' : 'off'"
                    [attr.aria-label]="label() + ' digit ' + ($index + 1)"
                    [attr.maxlength]="$index === 0 ? length() : 1"
                    [value]="digit"
                    [disabled]="disabled()"
                    (input)="onInput($index, $event)"
                    (keydown)="onKeydown($index, $event)"
                    (paste)="onPaste($index, $event)"
                    (focus)="select($event)" />
            }
        </div>
    `,
    styles: [`
        :host { display: block; }
        .code-boxes { display: flex; gap: 8px; justify-content: center; }
        .code-box {
            width: 44px; height: 52px; padding: 0;
            text-align: center; font-size: 1.4rem; font-weight: 600;
            border: 1px solid #ced4da; border-radius: 8px; background: #fff; color: #212529;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
        }
        .code-box:focus { outline: none; border-color: #0d6efd; box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.2); }
        .code-box.is-invalid { border-color: #dc3545; }
        .code-box:disabled { background: #f1f3f5; }
        @media (max-width: 380px) { .code-boxes { gap: 6px; } .code-box { width: 40px; height: 48px; } }
    `],
})
export class CodeInputComponent {
    readonly length = input(6);
    /** Hide the digits (a PIN). */
    readonly masked = input(false);
    readonly disabled = input(false);
    readonly invalid = input(false);
    /** Let the phone offer a code from an SMS (off for PINs). */
    readonly oneTimeCode = input(true);
    readonly label = input('Code');
    readonly autofocus = input(true);

    /** Every box filled: the full code. */
    readonly completed = output<string>();
    /** Any change: the digits so far. */
    readonly changed = output<string>();

    private readonly boxes = viewChildren<ElementRef<HTMLInputElement>>('box');
    private readonly entered = signal<string[]>([]);

    readonly digits = computed(() => {
        const values = this.entered();
        return Array.from({ length: this.length() }, (_, i) => values[i] ?? '');
    });
    readonly value = computed(() => this.digits().join(''));

    constructor() {
        afterNextRender(() => {
            if (this.autofocus()) this.focus(0);
        });
    }

    /** Empty every box and put the cursor in the first one. */
    reset(): void {
        this.entered.set([]);
        this.syncBoxes();
        setTimeout(() => this.focus(0));
    }

    /** Put a whole code in the boxes, as if pasted (fires `completed`). */
    fill(code: string): void {
        this.fillFrom(0, code.replace(/\D/g, ''));
    }

    focus(index = 0): void {
        this.boxes()[index]?.nativeElement.focus();
    }

    select(event: Event): void {
        (event.target as HTMLInputElement).select();
    }

    onInput(index: number, event: Event): void {
        const box = event.target as HTMLInputElement;
        const typed = box.value.replace(/\D/g, '');
        if (typed.length > 1) {
            // The phone filled the whole code into one box.
            this.fillFrom(index, typed);
            return;
        }
        this.setDigit(index, typed);
        box.value = typed;
        if (typed && index < this.length() - 1) this.focus(index + 1);
        this.emit();
    }

    onKeydown(index: number, event: KeyboardEvent): void {
        const box = event.target as HTMLInputElement;
        if (event.key === 'Backspace' && !box.value && index > 0) {
            event.preventDefault();
            this.setDigit(index - 1, '');
            this.syncBoxes();
            this.focus(index - 1);
            this.emit();
        } else if (event.key === 'ArrowLeft' && index > 0) {
            event.preventDefault();
            this.focus(index - 1);
        } else if (event.key === 'ArrowRight' && index < this.length() - 1) {
            event.preventDefault();
            this.focus(index + 1);
        }
    }

    onPaste(index: number, event: ClipboardEvent): void {
        const text = event.clipboardData?.getData('text') ?? '';
        event.preventDefault();
        const code = extractCode(text, this.length());
        if (code) {
            this.fillFrom(0, code);
        } else {
            this.fillFrom(index, text.replace(/\D/g, ''));
        }
    }

    private fillFrom(start: number, digits: string): void {
        const next = [...this.digits()];
        for (let i = 0; i < digits.length && start + i < this.length(); i++) next[start + i] = digits[i];
        this.entered.set(next);
        this.syncBoxes();
        const firstEmpty = next.findIndex((d) => !d);
        this.focus(firstEmpty === -1 ? this.length() - 1 : firstEmpty);
        this.emit();
    }

    private setDigit(index: number, digit: string): void {
        const next = [...this.digits()];
        next[index] = digit;
        this.entered.set(next);
    }

    /** Boxes the user typed into keep their own DOM value; write the model back. */
    private syncBoxes(): void {
        const digits = this.digits();
        this.boxes().forEach((box, i) => (box.nativeElement.value = digits[i]));
    }

    private emit(): void {
        const value = this.value();
        this.changed.emit(value);
        if (value.length === this.length() && /^\d+$/.test(value)) this.completed.emit(value);
    }
}
