import { describe, it, expect, vi } from 'vitest';
import { KEYBOARD_GAP_PX, keyboardHeight, scrollNeeded, trackKeyboard } from './keyboard-viewport';

describe('keyboardHeight', () => {
    it('is what the visual viewport lost to the keyboard', () => {
        expect(keyboardHeight(852, 520)).toBe(332);
    });

    it('is 0 for a browser bar moving, which is not a keyboard', () => {
        expect(keyboardHeight(852, 800)).toBe(0);
        expect(keyboardHeight(852, 852)).toBe(0);
    });
});

describe('scrollNeeded', () => {
    it('is how far a button under the keyboard must move to sit just above it', () => {
        // Visual viewport 0..520, the button's bottom at 600: 80 past it, plus the gap.
        expect(scrollNeeded(600, 0, 520)).toBe(600 - (520 - KEYBOARD_GAP_PX));
    });

    it('is 0 when the button is in sight already', () => {
        expect(scrollNeeded(300, 0, 520)).toBe(0);
    });

    it('counts from the top of the visual viewport once it has panned', () => {
        expect(scrollNeeded(600, 100, 520)).toBe(0);
    });
});

describe('trackKeyboard', () => {
    function setup(visualHeight: number) {
        document.body.innerHTML = '<div id="host"><input id="field"><button type="submit">Continue</button></div>';
        const host = document.getElementById('host')!;
        const field = document.getElementById('field') as HTMLInputElement;
        const button = host.querySelector('button')!;
        button.getBoundingClientRect = () => ({ bottom: 700 }) as DOMRect;
        const listeners = new Map<string, () => void>();
        const viewport = {
            height: visualHeight,
            offsetTop: 0,
            addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
            removeEventListener: (type: string) => listeners.delete(type),
        };
        const scrollBy = vi.fn();
        const win = { innerHeight: 852, visualViewport: viewport, scrollBy } as unknown as Window;
        return { host, field, viewport, listeners, scrollBy, stop: trackKeyboard(host, win) };
    }

    it('gives the page the keyboard\'s height and scrolls Continue above it while a field is focused', () => {
        const { host, field, viewport, listeners, scrollBy } = setup(520);
        field.focus();
        listeners.get('resize')!();
        expect(host.classList.contains('keyboard-open')).toBe(true);
        expect(host.style.getPropertyValue('--arc-keyboard-height')).toBe('332px');
        expect(scrollBy).toHaveBeenCalledWith({ top: 700 - (viewport.height - KEYBOARD_GAP_PX), behavior: 'smooth' });
    });

    it('does nothing when no field has the focus, or the keyboard is down', () => {
        const { host, field, viewport, listeners, scrollBy } = setup(852);
        field.focus();
        listeners.get('resize')!();
        expect(host.classList.contains('keyboard-open')).toBe(false);
        expect(scrollBy).not.toHaveBeenCalled();
        viewport.height = 520;
        field.blur();
        listeners.get('resize')!();
        expect(host.classList.contains('keyboard-open')).toBe(false);
    });

    it('stops listening and cleans up', () => {
        const { host, field, listeners, stop } = setup(520);
        field.focus();
        listeners.get('resize')!();
        stop();
        expect(listeners.size).toBe(0);
        expect(host.classList.contains('keyboard-open')).toBe(false);
        expect(host.style.getPropertyValue('--arc-keyboard-height')).toBe('');
    });

    it('does nothing where there is no visual viewport', () => {
        document.body.innerHTML = '<div id="host"></div>';
        expect(() => trackKeyboard(document.getElementById('host')!, {} as Window)()).not.toThrow();
    });
});
