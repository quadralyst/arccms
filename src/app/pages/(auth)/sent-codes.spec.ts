import { describe, expect, it } from 'vitest';
import { CODE_LIFE_MS, SentCodes } from './sent-codes';

describe('SentCodes', () => {
    it('remembers a code for its life, and what is left of the minute', () => {
        let now = 1_000_000;
        const codes = new SentCodes(() => now);
        codes.remember('phone:signup:+91', { testCode: '482913', testCodeInLogs: false });
        now += 21_000;
        expect(codes.fresh('phone:signup:+91')?.testCode).toBe('482913');
        expect(codes.secondsLeft('phone:signup:+91')).toBe(39);
        now += 60_000;
        expect(codes.secondsLeft('phone:signup:+91')).toBe(0);
        now = 1_000_000 + CODE_LIFE_MS;
        expect(codes.fresh('phone:signup:+91')).toBeNull();
    });

    it('takes the server\'s seconds left for a code it did not see sent', () => {
        const codes = new SentCodes(() => 5_000_000);
        codes.remember('k', { testCode: '', testCodeInLogs: false }, 39);
        expect(codes.secondsLeft('k')).toBe(39);
    });

    it('forgets a used or spent code', () => {
        const codes = new SentCodes();
        codes.remember('k', { testCode: '', testCodeInLogs: false });
        codes.forget('k');
        expect(codes.fresh('k')).toBeNull();
        expect(codes.secondsLeft('k')).toBe(0);
    });
});
