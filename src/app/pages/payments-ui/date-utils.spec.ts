import { describe, it, expect } from 'vitest';
import { toJsDate } from './date-utils';

describe('toJsDate', () => {
    it('returns null for nullish/garbage input', () => {
        expect(toJsDate(null)).toBeNull();
        expect(toJsDate(undefined)).toBeNull();
        expect(toJsDate({})).toBeNull();
        expect(toJsDate('not-a-date')).toBeNull();
    });

    it('passes through a Date', () => {
        const d = new Date('2026-07-10T00:00:00Z');
        expect(toJsDate(d)).toBe(d);
    });

    it('converts a Firestore Timestamp (via toDate())', () => {
        const target = new Date('2026-08-01T12:00:00Z');
        const ts = { toDate: () => target };
        expect(toJsDate(ts)).toBe(target);
    });

    it('converts a serialized timestamp { seconds }', () => {
        const secs = Math.floor(Date.parse('2026-01-02T03:04:05Z') / 1000);
        const result = toJsDate({ seconds: secs, nanoseconds: 0 });
        expect(result).toBeInstanceOf(Date);
        expect(result?.getTime()).toBe(secs * 1000);
    });

    it('parses an ISO string and epoch millis', () => {
        expect(toJsDate('2026-07-10T00:00:00.000Z')?.toISOString()).toBe('2026-07-10T00:00:00.000Z');
        const ms = Date.parse('2026-07-10T00:00:00Z');
        expect(toJsDate(ms)?.getTime()).toBe(ms);
    });

    it('returns null if toDate() throws', () => {
        expect(toJsDate({ toDate: () => { throw new Error('bad'); } })).toBeNull();
    });
});
