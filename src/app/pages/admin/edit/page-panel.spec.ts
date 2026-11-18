/**
 * The Page settings panel on the edit-on-page screen (specs/visual-editing-spec.md,
 * VE-D26): one state for the button, the handle and Escape, the handle's drag,
 * and the peek with its skip and reduced-motion cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PagePanel, PEEK_DELAY_MS, PEEK_HOLD_MS, PEEK_PX } from './page-panel';

describe('PagePanel', () => {
    let panel: PagePanel;

    beforeEach(() => {
        vi.useFakeTimers();
        panel = new PagePanel();
        panel.width.set(300);
    });

    afterEach(() => {
        panel.destroy();
        vi.useRealTimers();
    });

    it('starts closed, and the button, the handle and Escape share one state', () => {
        expect(panel.open()).toBe(false);
        expect(panel.shown()).toBe(0);
        panel.toggle(); // the strip's Page settings button
        expect(panel.open()).toBe(true);
        expect(panel.shown()).toBe(300);
        panel.press(900, 300); // the handle, clicked
        panel.release();
        expect(panel.open()).toBe(false);
        panel.toggle();
        expect(panel.escape()).toBe(true);
        expect(panel.open()).toBe(false);
        expect(panel.escape()).toBe(false);
    });

    it('sits fully out or fully in by percentage when settled, whatever width it was resized to', () => {
        expect(panel.transform()).toBe('translateX(100%)');
        panel.setOpen(true);
        expect(panel.transform()).toBe('translateX(0)');
        panel.press(700, 300);
        panel.move(760);
        expect(panel.transform()).toBe('translateX(calc(100% - 240px))');
        panel.release();
        expect(panel.transform()).toBe('translateX(0)');
    });

    it('is not closed by a click on the page', () => {
        panel.setOpen(true);
        panel.touch();
        expect(panel.open()).toBe(true);
    });

    it('follows the pointer while the handle is dragged, and opens when pulled past a third', () => {
        panel.press(1000, 300);
        panel.move(950);
        expect(panel.dragging()).toBe(true);
        expect(panel.shown()).toBe(50);
        panel.move(880);
        expect(panel.shown()).toBe(120);
        panel.release();
        expect(panel.open()).toBe(true);
        expect(panel.shown()).toBe(300);
        expect(panel.dragging()).toBe(false);
    });

    it('slides back when pulled less than a third', () => {
        panel.press(1000, 300);
        panel.move(920);
        panel.release();
        expect(panel.open()).toBe(false);
        expect(panel.shown()).toBe(0);
    });

    it('closes an open panel dragged right past a third, and keeps it open otherwise', () => {
        panel.setOpen(true);
        panel.press(700, 300);
        panel.move(760);
        panel.release();
        expect(panel.open()).toBe(true);
        panel.press(700, 300);
        panel.move(820);
        panel.release();
        expect(panel.open()).toBe(false);
    });

    it('never pulls past its width or below nothing', () => {
        panel.press(1000, 300);
        panel.move(100);
        expect(panel.shown()).toBe(300);
        panel.move(1500);
        expect(panel.shown()).toBe(0);
        panel.cancel();
        expect(panel.open()).toBe(false);
    });

    it('peeks once the page is drawn: out a little, held, then back', () => {
        panel.peek(false);
        expect(panel.shown()).toBe(0);
        vi.advanceTimersByTime(PEEK_DELAY_MS);
        expect(panel.peeking()).toBe(true);
        expect(panel.shown()).toBe(PEEK_PX);
        expect(panel.open()).toBe(false);
        vi.advanceTimersByTime(PEEK_HOLD_MS);
        expect(panel.peeking()).toBe(false);
        expect(panel.shown()).toBe(0);
    });

    it('does not peek when the editor already clicked or typed in the page', () => {
        panel.touch();
        panel.peek(false);
        vi.advanceTimersByTime(PEEK_DELAY_MS + PEEK_HOLD_MS);
        expect(panel.peeking()).toBe(false);
        expect(panel.shown()).toBe(0);
    });

    it('stops a peek under way when the editor touches the page', () => {
        panel.peek(false);
        vi.advanceTimersByTime(PEEK_DELAY_MS);
        expect(panel.shown()).toBe(PEEK_PX);
        panel.touch();
        expect(panel.peeking()).toBe(false);
        expect(panel.shown()).toBe(0);
    });

    it('does not move when the computer asks for less motion', () => {
        panel.peek(true);
        vi.advanceTimersByTime(PEEK_DELAY_MS + PEEK_HOLD_MS);
        expect(panel.peeking()).toBe(false);
        expect(panel.shown()).toBe(0);
    });

    it('opens fully from the peek when the button is pressed', () => {
        panel.peek(false);
        vi.advanceTimersByTime(PEEK_DELAY_MS);
        panel.toggle();
        expect(panel.open()).toBe(true);
        expect(panel.shown()).toBe(300);
        vi.advanceTimersByTime(PEEK_HOLD_MS);
        expect(panel.shown()).toBe(300);
    });
});
