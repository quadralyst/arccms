import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NewPinInputComponent } from './new-pin-input.component';
import { translocoTestingModule } from '../../../test/transloco-test-providers';
import { english } from '../../../test/english';

async function setup() {
    TestBed.configureTestingModule({ imports: [NewPinInputComponent, translocoTestingModule()] });
    const fixture = TestBed.createComponent(NewPinInputComponent);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    const completed = vi.fn();
    component.completed.subscribe(completed);
    const rows = () => [...fixture.nativeElement.querySelectorAll('arc-code-input')].map((row) => [...(row as HTMLElement).querySelectorAll('input')] as HTMLInputElement[]);
    const typeRow = (row: number, digits: string) => [...digits].forEach((d, i) => {
        const box = rows()[row][i];
        box.value = d;
        box.dispatchEvent(new Event('input'));
    });
    const held = () => rows().map((row) => row.map((box) => box.value).join(''));
    return { fixture, component, completed, rows, typeRow, held };
}

afterEach(() => document.body.replaceChildren());

describe('NewPinInputComponent: a new PIN, typed twice', () => {
    it('shows two rows of six masked boxes under "Your new PIN" and "Type it again"', async () => {
        const { fixture, rows } = await setup();
        const labels = [...fixture.nativeElement.querySelectorAll('.new-pin-label')].map((el) => (el as HTMLElement).textContent!.trim());
        expect(labels).toEqual([english('member.auth.your_new_pin'), english('member.auth.pin_again')]);
        expect(rows().map((row) => row.length)).toEqual([6, 6]);
        expect(rows().flat().every((box) => box.type === 'password')).toBe(true);
        // Never offered a code from an SMS: it is a PIN the person chooses.
        expect(rows().flat().some((box) => box.getAttribute('autocomplete') === 'one-time-code')).toBe(false);
    });

    it('moves the cursor to the second row once the first is full, and fires completed on its last digit', async () => {
        const { completed, rows, typeRow } = await setup();
        typeRow(0, '482913');
        expect(document.activeElement).toBe(rows()[1][0]);
        typeRow(1, '48291');
        expect(completed).not.toHaveBeenCalled();
        typeRow(1, '482913');
        expect(completed).toHaveBeenCalledTimes(1);
    });

    it('gives the PIN only when both rows hold the same six digits', async () => {
        const { component, typeRow } = await setup();
        expect(component.check()).toEqual({ problem: 'member.auth.choose_pin' });
        typeRow(0, '482913');
        expect(component.check()).toEqual({ problem: 'member.auth.pin_again_needed' });
        typeRow(1, '482913');
        expect(component.check()).toEqual({ pin: '482913' });
    });

    it('two that differ: no PIN, both rows emptied and the cursor back in the first', async () => {
        const { component, rows, typeRow, held } = await setup();
        typeRow(0, '482913');
        typeRow(1, '482931');
        expect(component.check()).toEqual({ problem: 'member.auth.pins_mismatch' });
        await new Promise((r) => setTimeout(r));
        expect(held()).toEqual(['', '']);
        expect(component.pin()).toBe('');
        expect(component.pinAgain()).toBe('');
        expect(document.activeElement).toBe(rows()[0][0]);
    });

    it('restart() empties both rows, for a PIN the server refused', async () => {
        const { component, typeRow, held } = await setup();
        typeRow(0, '111111');
        typeRow(1, '111111');
        component.restart();
        expect(held()).toEqual(['', '']);
        expect(component.check()).toEqual({ problem: 'member.auth.choose_pin' });
    });
});
