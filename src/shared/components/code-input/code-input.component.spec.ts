import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CodeInputComponent } from './code-input.component';

function setup(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(CodeInputComponent);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const completed = vi.fn();
    component.completed.subscribe(completed);
    const boxes = () => Array.from(fixture.nativeElement.querySelectorAll('input')) as HTMLInputElement[];
    return { fixture, component, completed, boxes };
}

function type(box: HTMLInputElement, value: string): void {
    box.value = value;
    box.dispatchEvent(new Event('input'));
}

function paste(box: HTMLInputElement, text: string): void {
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    box.dispatchEvent(event);
}

describe('CodeInputComponent', () => {
    it('renders six boxes, the first offered for a code from SMS', () => {
        const { boxes } = setup();
        expect(boxes()).toHaveLength(6);
        expect(boxes()[0].getAttribute('autocomplete')).toBe('one-time-code');
        expect(boxes()[1].getAttribute('autocomplete')).toBe('off');
    });

    it('fires completed as soon as the last digit is typed', () => {
        const { boxes, completed } = setup();
        '48291'.split('').forEach((d, i) => type(boxes()[i], d));
        expect(completed).not.toHaveBeenCalled();
        type(boxes()[5], '3');
        expect(completed).toHaveBeenCalledWith('482913');
    });

    it('ignores letters', () => {
        const { boxes, component } = setup();
        type(boxes()[0], 'a');
        expect(component.value()).toBe('');
    });

    it('fills every box from a pasted message and completes', () => {
        const { boxes, completed } = setup();
        paste(boxes()[3], 'Your code is 482 913.');
        expect(boxes().map((b) => b.value).join('')).toBe('482913');
        expect(completed).toHaveBeenCalledWith('482913');
    });

    it('fills every box when the phone puts the whole code into the first one', () => {
        const { boxes, completed } = setup();
        type(boxes()[0], '482913');
        expect(completed).toHaveBeenCalledWith('482913');
    });

    it('masks a PIN and does not offer SMS codes for it', () => {
        const { boxes } = setup({ masked: true, oneTimeCode: false });
        expect(boxes()[0].type).toBe('password');
        expect(boxes()[0].getAttribute('autocomplete')).toBe('off');
    });

    it('Backspace in an empty box clears the one before', () => {
        const { boxes, component } = setup();
        type(boxes()[0], '4');
        type(boxes()[1], '8');
        boxes()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
        expect(component.value()).toBe('4');
    });

    it('fill puts a whole code in and completes (the test-mode code)', () => {
        const { boxes, completed, component } = setup();
        component.fill('482913');
        expect(boxes().map((b) => b.value).join('')).toBe('482913');
        expect(completed).toHaveBeenCalledWith('482913');
    });

    it('reset empties the boxes', () => {
        const { boxes, component, fixture } = setup();
        paste(boxes()[0], '482913');
        component.reset();
        fixture.detectChanges();
        expect(component.value()).toBe('');
        expect(boxes().every((b) => b.value === '')).toBe(true);
    });
});
