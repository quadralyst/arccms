/**
 * One way to show a moment in a zone (specs/clock-and-zones-spec.md, T-D12 to T-D14;
 * docs/app/clock-and-zones.html).
 *
 * Angular's `| date` takes a zone only as a fixed offset, so it is wrong on one side of
 * every summer time change. This formats with `Intl.DateTimeFormat` and a zone name.
 * The pipe and the service that pick the zone and the locale are in arc-time.pipe.ts and
 * arc-time.service.ts; this file is pure.
 */
import { formatDate } from '@angular/common';
import { dayKeyDiff, firstZone, zoneCity, zonedDayKey, zoneOffsetMinutes } from './zones';

/** The formats with a name. Any other string is an Angular date pattern (`'MMM d, y'`). */
export const ARC_TIME_FORMATS = [
    'time', 'date', 'dateTime', 'short', 'medium', 'long', 'full', 'day', 'ago', 'place', 'placeDateTime',
] as const;
export type ArcTimeFormatName = (typeof ARC_TIME_FORMATS)[number];

/** A named format, `Intl.DateTimeFormat` options, or an Angular date pattern. */
export type ArcTimeFormat = ArcTimeFormatName | Intl.DateTimeFormatOptions | (string & {});

/** Anything a moment is stored as: a Date, epoch ms, an ISO string, a Firestore Timestamp or its `{ seconds, nanoseconds }`. */
export type MomentInput = Date | number | string | { toDate(): Date } | { seconds: number; nanoseconds?: number } | null | undefined;

export interface ArcTimeOptions {
    /** BCP-47 locale for `Intl` (`de-CH`). Default `en-US`. */
    locale?: string;
    /** A locale Angular has data for, used only by an Angular pattern. Default `en-US`. */
    angularLocale?: string;
    /** Now, in epoch ms, for `day` and `ago`: pass `ArcClock.now()`. Default `Date.now()`. */
    now?: number;
    /** For `place`: the zone of the person reading. Default UTC. */
    viewerZone?: string;
    /** For `place`: the place's name. Default the city of its zone. */
    placeName?: string;
    /** For `place`: the words around the reader's time. Default `"<time> for you"`. */
    forYou?: (time: string) => string;
}

/** The moment a value stands for, in epoch ms, or null when it is empty or not a date. */
export function toMoment(value: MomentInput): number | null {
    if (value === null || value === undefined || value === '') return null;
    let ms: number;
    if (value instanceof Date) ms = value.getTime();
    else if (typeof value === 'number') ms = value;
    else if (typeof value === 'string') ms = Date.parse(value);
    else if (typeof (value as { toDate?: unknown }).toDate === 'function') ms = (value as { toDate(): Date }).toDate().getTime();
    else if (typeof (value as { seconds?: unknown }).seconds === 'number') {
        const stamp = value as { seconds: number; nanoseconds?: number };
        ms = stamp.seconds * 1000 + Math.floor((stamp.nanoseconds ?? 0) / 1e6);
    } else return null;
    return Number.isFinite(ms) ? ms : null;
}

const PRESETS: Record<Exclude<ArcTimeFormatName, 'day' | 'ago' | 'place' | 'placeDateTime'>, Intl.DateTimeFormatOptions> = {
    time: { timeStyle: 'short' },
    date: { dateStyle: 'medium' },
    dateTime: { dateStyle: 'medium', timeStyle: 'short' },
    short: { dateStyle: 'short', timeStyle: 'short' },
    medium: { dateStyle: 'medium', timeStyle: 'medium' },
    long: { dateStyle: 'long', timeStyle: 'long' },
    full: { dateStyle: 'full', timeStyle: 'full' },
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: string, zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale}|${zone}|${JSON.stringify(options)}`;
    let formatter = formatters.get(key);
    if (!formatter) {
        try {
            formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
        } catch {
            // A locale the browser does not know: English rather than nothing.
            formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone });
        }
        formatters.set(key, formatter);
    }
    return formatter;
}

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
    let formatter = relativeFormatters.get(locale);
    if (!formatter) {
        try {
            formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
        } catch {
            formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
        }
        relativeFormatters.set(locale, formatter);
    }
    return formatter;
}

function capitalise(text: string, locale: string): string {
    return text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text;
}

/** `+0530` for Angular's `formatDate`, from the zone's offset at that moment. */
function angularOffset(zone: string, moment: number): string {
    const minutes = zoneOffsetMinutes(zone, moment);
    const abs = Math.abs(minutes);
    return `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

/** "Today", "Yesterday" or "Tomorrow" in the reader's zone, else the date. */
function dayText(moment: number, zone: string, locale: string, now: number): string {
    const days = dayKeyDiff(zonedDayKey(zone, now), zonedDayKey(zone, moment));
    if (Math.abs(days) <= 1) return capitalise(relativeFormatter(locale).format(days, 'day'), locale);
    return dateFormatter(locale, zone, PRESETS.date).format(moment);
}

/** "now", "2 minutes ago", "in 3 hours", up to 30 days; the date after that. */
function agoText(moment: number, zone: string, locale: string, now: number): string {
    const diff = moment - now;
    const seconds = Math.trunc(diff / 1000);
    const rtf = relativeFormatter(locale);
    if (Math.abs(seconds) < 60) return rtf.format(0, 'second');
    const minutes = Math.trunc(seconds / 60);
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
    const hours = Math.trunc(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    const days = Math.trunc(hours / 24);
    if (Math.abs(days) < 30) return rtf.format(days, 'day');
    return dateFormatter(locale, zone, PRESETS.date).format(moment);
}

/**
 * A place's time, and the reader's when it differs (T-D13): "22:00 Zurich (01:30 for you)",
 * with the reader's weekday when their day is another one: "(Sat 01:30 for you)".
 */
function placeText(moment: number, placeZone: string, locale: string, options: ArcTimeOptions, withDate: boolean): string {
    const viewerZone = firstZone(options.viewerZone);
    const preset = withDate ? PRESETS.dateTime : PRESETS.time;
    const there = dateFormatter(locale, placeZone, preset).format(moment);
    // The reader is on the place's clock: nothing to add.
    if (zoneOffsetMinutes(placeZone, moment) === zoneOffsetMinutes(viewerZone, moment)) return there;
    const name = options.placeName?.trim() || zoneCity(placeZone);
    const otherDay = zonedDayKey(placeZone, moment) !== zonedDayKey(viewerZone, moment);
    let here = dateFormatter(locale, viewerZone, preset).format(moment);
    // A time style cannot be mixed with a weekday in one Intl format, so the weekday comes first on its own.
    if (!withDate && otherDay) here = `${dateFormatter(locale, viewerZone, { weekday: 'short' }).format(moment)} ${here}`;
    const forYou = options.forYou ?? ((time: string) => `${time} for you`);
    return `${there} ${name} (${forYou(here)})`;
}

/**
 * A moment in a zone, as text. `zone` is an IANA name; an unknown one is read as UTC.
 * An empty or invalid moment gives an empty string, never "Invalid Date".
 *
 *     formatArcTime(sentAt, 'time', 'Asia/Kolkata', { locale: 'en-IN' })   // "1:30 am"
 *     formatArcTime(at, 'place', 'Europe/Zurich', { viewerZone: 'Asia/Kolkata', locale: 'de-CH' })
 *         // "22:00 Zurich (So 01:30 for you)"
 */
export function formatArcTime(value: MomentInput, format: ArcTimeFormat = 'dateTime', zone?: string, options: ArcTimeOptions = {}): string {
    const moment = toMoment(value);
    if (moment === null) return '';
    const tz = firstZone(zone);
    const locale = options.locale || 'en-US';
    const now = options.now ?? Date.now();

    if (typeof format === 'object' && format !== null) return dateFormatter(locale, tz, format).format(moment);
    switch (format) {
        case 'day': return dayText(moment, tz, locale, now);
        case 'ago': return agoText(moment, tz, locale, now);
        case 'place': return placeText(moment, tz, locale, options, false);
        case 'placeDateTime': return placeText(moment, tz, locale, options, true);
    }
    if (format in PRESETS) return dateFormatter(locale, tz, PRESETS[format as keyof typeof PRESETS]).format(moment);
    // An Angular pattern: formatDate, with the offset this zone has at this very moment.
    try {
        return formatDate(moment, format, options.angularLocale || 'en-US', angularOffset(tz, moment));
    } catch {
        return formatDate(moment, format, 'en-US', angularOffset(tz, moment));
    }
}
