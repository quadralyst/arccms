import { describe, expect, it } from 'vitest';
import { formatArcTime, toMoment } from './arc-time';

const at = (iso: string) => Date.parse(iso);
/** Intl puts narrow no-break spaces before "PM" and in some dates; compare on plain spaces. */
const plain = (text: string) => text.replace(/\s/g, ' ');
const fmt = (...args: Parameters<typeof formatArcTime>) => plain(formatArcTime(...args));

// The worked example (specs/clock-and-zones-spec.md, section 2): Anna in Zurich, Ravi in Pune.
const ANNA = 'Europe/Zurich';
const RAVI = 'Asia/Kolkata';
/** Saturday 24 October 2026, 22:00 in Zurich, Sunday 01:30 in Pune. */
const MESSAGE = at('2026-10-24T20:00:00Z');

describe('arcTime formatting (specs/clock-and-zones-spec.md, T-D12 to T-D14)', () => {
    it('reads every way a moment is stored, and gives nothing for an empty or bad one', () => {
        const ms = MESSAGE;
        expect(toMoment(new Date(ms))).toBe(ms);
        expect(toMoment(ms)).toBe(ms);
        expect(toMoment('2026-10-24T20:00:00Z')).toBe(ms);
        expect(toMoment({ toDate: () => new Date(ms) })).toBe(ms);
        expect(toMoment({ seconds: ms / 1000, nanoseconds: 5_000_000 })).toBe(ms + 5);
        for (const empty of [null, undefined, '', 'not a date', NaN, {} as never]) {
            expect(toMoment(empty)).toBeNull();
            expect(formatArcTime(empty, 'dateTime', ANNA)).toBe('');
        }
    });

    it('shows each reader the moment on their own clock', () => {
        expect(fmt(MESSAGE, 'time', ANNA, { locale: 'de-CH' })).toBe('22:00');
        expect(fmt(MESSAGE, 'time', RAVI, { locale: 'en-GB' })).toBe('01:30');
        expect(fmt(MESSAGE, 'time', 'America/Phoenix', { locale: 'en-US' })).toBe('1:00 PM');
    });

    it('takes 12 or 24 hours from the locale', () => {
        expect(fmt(MESSAGE, 'time', ANNA, { locale: 'en-US' })).toBe('10:00 PM');
        expect(fmt(MESSAGE, 'time', ANNA, { locale: 'en-GB' })).toBe('22:00');
        expect(fmt(MESSAGE, 'dateTime', ANNA, { locale: 'en-GB' })).toBe('24 Oct 2026, 22:00');
    });

    it('is right on both sides of a summer time change, and on the hour that happens twice', () => {
        expect(fmt(at('2026-03-29T00:30:00Z'), 'time', ANNA, { locale: 'en-GB' })).toBe('01:30');
        expect(fmt(at('2026-03-29T01:30:00Z'), 'time', ANNA, { locale: 'en-GB' })).toBe('03:30');
        expect(fmt(at('2026-10-25T00:30:00Z'), 'time', ANNA, { locale: 'en-GB' })).toBe('02:30');
        expect(fmt(at('2026-10-25T01:30:00Z'), 'time', ANNA, { locale: 'en-GB' })).toBe('02:30');
        expect(fmt(at('2026-10-25T00:30:00Z'), 'long', ANNA, { locale: 'en-GB' })).toContain('CEST');
        expect(fmt(at('2026-10-25T01:30:00Z'), 'long', ANNA, { locale: 'en-GB' })).toContain('CET');
    });

    it('keeps the half hour in Kolkata and standard time in Phoenix all year', () => {
        expect(fmt(at('2026-01-15T12:00:00Z'), 'time', RAVI, { locale: 'en-GB' })).toBe('17:30');
        expect(fmt(at('2026-07-15T12:00:00Z'), 'time', RAVI, { locale: 'en-GB' })).toBe('17:30');
        expect(fmt(at('2026-01-15T12:00:00Z'), 'time', 'America/Phoenix', { locale: 'en-GB' })).toBe('05:00');
        expect(fmt(at('2026-07-15T12:00:00Z'), 'time', 'America/Phoenix', { locale: 'en-GB' })).toBe('05:00');
        expect(fmt(at('2026-07-15T12:00:00Z'), 'time', 'America/Denver', { locale: 'en-GB' })).toBe('06:00');
    });

    it('formats an Angular pattern with the zone\'s offset at that moment, so app tables keep their dateFormat', () => {
        expect(fmt(at('2026-10-25T00:30:00Z'), 'HH:mm', ANNA)).toBe('02:30');
        expect(fmt(at('2026-10-25T01:30:00Z'), 'HH:mm', ANNA)).toBe('02:30');
        expect(fmt(at('2026-07-15T12:00:00Z'), 'MMM d, y, HH:mm', RAVI)).toBe('Jul 15, 2026, 17:30');
        expect(fmt(at('2026-07-15T12:00:00Z'), 'HH:mm', 'America/Phoenix')).toBe('05:00');
        expect(fmt(MESSAGE, 'MMM d, y', RAVI)).toBe('Oct 25, 2026');
    });

    it('reads a name that is not one of its formats as an Angular pattern, never as an object property', () => {
        expect(() => formatArcTime(MESSAGE, 'toString', ANNA)).not.toThrow();
        expect(formatArcTime(MESSAGE, 'constructor', ANNA)).not.toContain('[object');
        // A pattern Angular cannot read shows the date and time rather than breaking the page.
        expect(fmt(MESSAGE, 'toString', ANNA, { locale: 'en-GB' })).toBe('24 Oct 2026, 22:00');
    });

    it('takes Intl options too', () => {
        expect(fmt(MESSAGE, { weekday: 'long' }, RAVI, { locale: 'en-GB' })).toBe('Sunday');
    });

    it('reads an unknown zone as UTC, and an unknown locale as English', () => {
        expect(fmt(MESSAGE, 'time', 'Mars/Olympus', { locale: 'en-GB' })).toBe('20:00');
        expect(fmt(MESSAGE, 'time', '+05:30', { locale: 'en-GB' })).toBe('20:00');
        expect(fmt(MESSAGE, 'time', ANNA, { locale: 'not a locale!' })).toBe('10:00 PM');
    });

    it('says Today and Yesterday by each reader\'s day', () => {
        const now = at('2026-10-24T20:05:00Z'); // 22:05 for Anna, 01:35 on Sunday for Ravi
        expect(fmt(MESSAGE, 'day', ANNA, { now })).toBe('Today');
        expect(fmt(MESSAGE, 'day', RAVI, { now })).toBe('Today');
        const evening = at('2026-10-24T18:00:00Z'); // 20:00 for Anna, 23:30 on Saturday for Ravi
        expect(fmt(evening, 'day', ANNA, { now })).toBe('Today');
        expect(fmt(evening, 'day', RAVI, { now })).toBe('Yesterday');
        expect(fmt(at('2026-10-25T20:00:00Z'), 'day', ANNA, { now })).toBe('Tomorrow');
        expect(fmt(at('2026-10-20T12:00:00Z'), 'day', ANNA, { now, locale: 'en-GB' })).toBe('20 Oct 2026');
        expect(fmt(evening, 'day', RAVI, { now, locale: 'de-CH' })).toBe('Gestern');
    });

    it('counts "ago" from the now it is given', () => {
        const now = MESSAGE + 150_000;
        expect(fmt(MESSAGE, 'ago', ANNA, { now })).toBe('2 minutes ago');
        expect(fmt(MESSAGE, 'ago', ANNA, { now: MESSAGE + 30_000 })).toBe('now');
        expect(fmt(MESSAGE, 'ago', ANNA, { now: MESSAGE - 3 * 3_600_000 })).toBe('in 3 hours');
        expect(fmt(MESSAGE, 'ago', ANNA, { now: MESSAGE + 2 * 86_400_000 })).toBe('2 days ago');
        expect(fmt(MESSAGE, 'ago', ANNA, { now: MESSAGE + 40 * 86_400_000, locale: 'en-GB' })).toBe('24 Oct 2026');
        expect(fmt(MESSAGE, 'ago', ANNA, { now, locale: 'de-CH' })).toBe('vor 2 Minuten');
    });

    it('labels a place\'s time with the reader\'s when it differs (T-D13)', () => {
        // Ravi reads a Zurich meeting: another day for him, so his weekday is added.
        expect(fmt(MESSAGE, 'place', ANNA, { viewerZone: RAVI, locale: 'en-GB' })).toBe('22:00 Zurich (Sun 01:30 for you)');
        // Anna is on the place's clock.
        expect(fmt(MESSAGE, 'place', ANNA, { viewerZone: ANNA, locale: 'en-GB' })).toBe('22:00');
        // Same day for both: no weekday. A name, and the words in the reader's language.
        const noon = at('2026-10-24T10:00:00Z');
        expect(fmt(noon, 'place', ANNA, {
            viewerZone: RAVI, locale: 'en-GB', placeName: 'Main Street', forYou: (t) => `${t} bei Ihnen`,
        })).toBe('12:00 Main Street (15:30 bei Ihnen)');
        expect(fmt(noon, 'placeDateTime', ANNA, { viewerZone: RAVI, locale: 'en-GB' })).toBe('24 Oct 2026, 12:00 Zurich (24 Oct 2026, 15:30 for you)');
        // A reader in Phoenix in summer, where the clocks differ by nine hours.
        expect(fmt(noon, 'place', ANNA, { viewerZone: 'America/Phoenix', locale: 'en-US' })).toBe('12:00 PM Zurich (3:00 AM for you)');
    });
});
