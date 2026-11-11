/** The sign-in steps in the browser's history (RF6, 6.4): step-history.ts, with a history of its own. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { STEP_HISTORY_KEY, StepHistory } from './step-history';
import { replacesStep } from './signup.page';
import { ClockCountdown, secondsUntil } from '../../../core/sign-in/clock-countdown';

/** Just enough of History: a list of states, where we are in it, and what go() asked for. */
function fakeHistory(start: unknown = { navigationId: 3 }) {
    const states: unknown[] = [start];
    let at = 0;
    const went: number[] = [];
    const history = {
        get state() { return states[at]; },
        get length() { return states.length; },
        pushState(state: unknown) { states.splice(at + 1); states.push(state); at = states.length - 1; },
        go(delta: number) { went.push(delta); at += delta; },
    } as unknown as History;
    return { history, went, states: () => states, at: () => at };
}

describe('StepHistory', () => {
    it('adds an entry per step, keeping the router\'s state in it', () => {
        const h = fakeHistory();
        const flow = new StepHistory('request', h.history);
        flow.push('verify');
        expect(flow.depth).toBe(1);
        expect(h.history.state).toEqual({ navigationId: 3, [STEP_HISTORY_KEY]: expect.objectContaining({ depth: 1 }) });
        expect(flow.landing(h.history.state)).toEqual({ depth: 1 });
    });

    it('replaces a step in its entry, so back skips it', () => {
        const h = fakeHistory();
        const flow = new StepHistory('request', h.history);
        flow.push('verify');
        flow.replace('signup');
        expect(h.states().length).toBe(2);
        expect(flow.stepAt(1)).toBe('signup');
        expect(flow.cutTo(0)).toBe('request');
    });

    it('goes back to a depth by taking the entries above it off', () => {
        const h = fakeHistory();
        const flow = new StepHistory('request', h.history);
        flow.push('login');
        flow.push('verify');
        flow.backTo(0);
        expect(h.went).toEqual([-2]);
        expect(flow.depth).toBe(0);
        flow.backTo(0);
        expect(h.went).toEqual([-2]);
    });

    it('reads an unmarked entry as the first one when the page opened on one', () => {
        const flow = new StepHistory('request', fakeHistory({ navigationId: 1 }).history);
        expect(flow.landing({ navigationId: 1 })).toEqual({ depth: 0 });
        expect(flow.landing(null)).toEqual({ depth: 0 });
    });

    it('opened on an earlier visit\'s step (a reload, or back from another page): the entries below lead out of sign-in', () => {
        const h = fakeHistory({ navigationId: 1, [STEP_HISTORY_KEY]: { id: 'old', depth: 2 } });
        const flow = new StepHistory('request', h.history);
        // The entry it opened on is its first step.
        expect(flow.landing({ navigationId: 1, [STEP_HISTORY_KEY]: { id: 'old', depth: 2 } })).toEqual({ depth: 0 });
        // That visit's step 1: one more step of it, then its first entry, then the page before.
        expect(flow.landing({ [STEP_HISTORY_KEY]: { id: 'old', depth: 1 } })).toEqual({ below: 2 });
        // That visit's first entry, with no mark: the page before is one further back.
        expect(flow.landing({ navigationId: 1 })).toEqual({ below: 1 });
    });

    it('marks the entry again to stay on a step', () => {
        const h = fakeHistory();
        const flow = new StepHistory('request', h.history);
        flow.push('choosePin');
        h.history.go(-1);
        flow.stay();
        expect(flow.landing(h.history.state)).toEqual({ depth: 1 });
    });
});

describe('which moves replace the step they leave', () => {
    it('replaces a used code and the details step, and a new PIN or password sent back to its code', () => {
        expect(replacesStep('verify', 'signup')).toBe(true);
        expect(replacesStep('verify', 'pin')).toBe(true);
        expect(replacesStep('signup', 'login')).toBe(true);
        expect(replacesStep('newPassword', 'verify')).toBe(true);
        expect(replacesStep('newPin', 'verify')).toBe(true);
        expect(replacesStep('request', 'verify')).toBe(false);
        expect(replacesStep('login', 'verify')).toBe(false);
        expect(replacesStep('pin', 'verify')).toBe(false);
    });
});

describe('secondsUntil (RF6, 6.11)', () => {
    it('counts whole seconds left, rounding up, never below 0 nor above the most', () => {
        expect(secondsUntil(61_000, 1_000)).toBe(60);
        expect(secondsUntil(61_000, 1_004)).toBe(60);
        expect(secondsUntil(61_000, 2_004)).toBe(59);
        expect(secondsUntil(61_000, 61_000)).toBe(0);
        expect(secondsUntil(61_000, 99_000)).toBe(0);
        expect(secondsUntil(61_000, -3_600_000, 60)).toBe(60);
    });
});

describe('ClockCountdown (RF6, 6.11)', () => {
    afterEach(() => vi.useRealTimers());

    function clock() {
        let now = 1_000_000;
        return { set: (t: number) => (now = t), add: (ms: number) => (now += ms), now: () => now };
    }

    it('reads the seconds from the clock on each tick and when the page is back in front', () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        const c = clock();
        const countdown = new ClockCountdown(c.now);
        countdown.start(60);
        expect(countdown.left()).toBe(60);
        c.add(45_000);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(countdown.left()).toBe(15);
        c.add(1_000);
        vi.advanceTimersByTime(1000);
        expect(countdown.left()).toBe(14);
        c.add(60_000);
        vi.advanceTimersByTime(1000);
        expect(countdown.left()).toBe(0);
    });

    it('never holds Resend back when the clock is moved back', () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        const c = clock();
        const countdown = new ClockCountdown(c.now);
        countdown.start(60);
        c.add(10_000);
        countdown.tick();
        expect(countdown.left()).toBe(50);
        // An hour back: still 50 left, never more than it started with.
        c.add(-3_600_000);
        countdown.tick();
        expect(countdown.left()).toBe(50);
        c.add(50_000);
        countdown.tick();
        expect(countdown.left()).toBe(0);
    });

    it('stops at 0 and stops listening', () => {
        const c = clock();
        const countdown = new ClockCountdown(c.now);
        countdown.start(5);
        countdown.stop();
        expect(countdown.left()).toBe(0);
        c.add(-10_000);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(countdown.left()).toBe(0);
    });
});
