import { describe, expect, it } from 'vitest';
import {
    UTC, allZones, canonicalZone, dayKeyDiff, deviceZone, firstZone, isZone, zoneCity, zoneLabel, zoneOffsetMinutes, zonedDayKey,
} from './zones';

const at = (iso: string) => Date.parse(iso);

describe('zones (specs/clock-and-zones-spec.md, T-D8)', () => {
    it('are IANA names, in their current spelling and case', () => {
        expect(canonicalZone('Europe/Zurich')).toBe('Europe/Zurich');
        expect(canonicalZone(' europe/zurich ')).toBe('Europe/Zurich');
        expect(canonicalZone('Asia/Calcutta')).toBe('Asia/Kolkata');
        expect(canonicalZone('Asia/Kolkata')).toBe('Asia/Kolkata');
        expect(canonicalZone('Europe/Kiev')).toBe('Europe/Kyiv');
        expect(canonicalZone('America/Godthab')).toBe('America/Nuuk');
        // Node and Chrome answer Asia/Katmandu for the current name; it comes back as given.
        expect(canonicalZone('Asia/Kathmandu')).toBe('Asia/Kathmandu');
        // Old links resolve to the zone they point to.
        expect(canonicalZone('US/Arizona')).toBe('America/Phoenix');
    });

    it('never an offset, an abbreviation or a fixed-offset zone; UTC by any of its names is UTC', () => {
        for (const bad of ['+05:30', '-0700', 'EST', 'CET', 'Etc/GMT+5', 'Foo/Bar', '', '  ', null, undefined, 42]) {
            expect(canonicalZone(bad), String(bad)).toBeNull();
            expect(isZone(bad)).toBe(false);
        }
        for (const utc of ['UTC', 'utc', 'Etc/UTC', 'GMT', 'Etc/GMT', 'Zulu']) expect(canonicalZone(utc)).toBe(UTC);
    });

    it('fall back to the next known zone, then UTC', () => {
        expect(firstZone('Mars/Olympus', null, 'Asia/Calcutta')).toBe('Asia/Kolkata');
        expect(firstZone(undefined, '+01:00')).toBe(UTC);
        expect(isZone(deviceZone())).toBe(true);
    });

    it('list every zone the browser knows by current name, UTC first, no old names', () => {
        const zones = allZones();
        expect(zones[0]).toBe(UTC);
        expect(zones).toContain('Europe/Zurich');
        expect(zones).toContain('Asia/Kolkata');
        expect(zones).not.toContain('Asia/Calcutta');
        expect(zones.filter((z) => z === UTC)).toHaveLength(1);
        expect(zones.some((z) => z.startsWith('Etc/'))).toBe(false);
    });

    it('know summer time in Zurich, including the hour that happens twice in October', () => {
        expect(zoneOffsetMinutes('Europe/Zurich', at('2026-01-15T12:00:00Z'))).toBe(60);
        expect(zoneOffsetMinutes('Europe/Zurich', at('2026-07-15T12:00:00Z'))).toBe(120);
        // 29 March 2026: 02:00 CET jumps to 03:00 CEST at 01:00 UTC.
        expect(zoneOffsetMinutes('Europe/Zurich', at('2026-03-29T00:59:00Z'))).toBe(60);
        expect(zoneOffsetMinutes('Europe/Zurich', at('2026-03-29T01:00:00Z'))).toBe(120);
        // 25 October 2026: 03:00 CEST goes back to 02:00 CET at 01:00 UTC; 02:30 happens twice.
        expect(zoneOffsetMinutes('Europe/Zurich', at('2026-10-25T00:30:00Z'))).toBe(120);
        expect(zoneOffsetMinutes('Europe/Zurich', at('2026-10-25T01:30:00Z'))).toBe(60);
    });

    it('know a half-hour zone with no summer time (Asia/Kolkata)', () => {
        expect(zoneOffsetMinutes('Asia/Kolkata', at('2026-01-15T12:00:00Z'))).toBe(330);
        expect(zoneOffsetMinutes('Asia/Kolkata', at('2026-07-15T12:00:00Z'))).toBe(330);
    });

    it('know a zone that keeps standard time while its neighbours change (America/Phoenix)', () => {
        expect(zoneOffsetMinutes('America/Phoenix', at('2026-01-15T12:00:00Z'))).toBe(-420);
        expect(zoneOffsetMinutes('America/Phoenix', at('2026-07-15T12:00:00Z'))).toBe(-420);
        expect(zoneOffsetMinutes('America/Denver', at('2026-07-15T12:00:00Z'))).toBe(-360);
    });

    it('give the calendar day in a zone, which can differ for two readers of one moment', () => {
        const moment = at('2026-10-24T20:00:00Z');
        expect(zonedDayKey('Europe/Zurich', moment)).toBe('2026-10-24');
        expect(zonedDayKey('Asia/Kolkata', moment)).toBe('2026-10-25');
        expect(zonedDayKey('America/Phoenix', moment)).toBe('2026-10-24');
        expect(dayKeyDiff('2026-10-24', '2026-10-25')).toBe(1);
        expect(dayKeyDiff('2026-03-29', '2026-03-28')).toBe(-1);
        expect(dayKeyDiff('2026-12-31', '2027-01-01')).toBe(1);
    });

    it('label a zone by its city and its offset at that moment', () => {
        expect(zoneCity('Europe/Zurich')).toBe('Zurich');
        expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
        expect(zoneCity('Asia/Calcutta')).toBe('Kolkata');
        expect(zoneCity(UTC)).toBe(UTC);
        expect(zoneLabel('Europe/Zurich', at('2026-07-15T12:00:00Z'))).toBe('Zurich, GMT+2');
        expect(zoneLabel('Europe/Zurich', at('2026-01-15T12:00:00Z'))).toBe('Zurich, GMT+1');
        expect(zoneLabel('Asia/Kolkata', at('2026-01-15T12:00:00Z'))).toBe('Kolkata, GMT+5:30');
        expect(zoneLabel(UTC)).toBe(UTC);
    });
});
