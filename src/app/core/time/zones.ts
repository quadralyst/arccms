/**
 * Time zones as IANA names (specs/clock-and-zones-spec.md, T-D8;
 * docs/app/clock-and-zones.html).
 *
 * A zone is always a name such as `Europe/Zurich`, never an offset (`+05:30`) or an
 * abbreviation (`EST`): only a name knows when summer time starts. Plain TypeScript on
 * `Intl`, with no Angular imports.
 */

/** The zone used when nothing better is known. */
export const UTC = 'UTC';

/**
 * Names some browsers (and Node) still report for zones that were renamed. `Intl` keeps
 * the old spelling as its canonical one, so Chrome can say `Asia/Calcutta` for India.
 */
const RENAMED: Readonly<Record<string, string>> = {
    'Africa/Asmera': 'Africa/Asmara',
    'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
    'America/Catamarca': 'America/Argentina/Catamarca',
    'America/Coral_Harbour': 'America/Atikokan',
    'America/Cordoba': 'America/Argentina/Cordoba',
    'America/Godthab': 'America/Nuuk',
    'America/Indianapolis': 'America/Indiana/Indianapolis',
    'America/Jujuy': 'America/Argentina/Jujuy',
    'America/Louisville': 'America/Kentucky/Louisville',
    'America/Mendoza': 'America/Argentina/Mendoza',
    'Asia/Calcutta': 'Asia/Kolkata',
    'Asia/Katmandu': 'Asia/Kathmandu',
    'Asia/Rangoon': 'Asia/Yangon',
    'Asia/Saigon': 'Asia/Ho_Chi_Minh',
    'Atlantic/Faeroe': 'Atlantic/Faroe',
    'Europe/Kiev': 'Europe/Kyiv',
    'Pacific/Enderbury': 'Pacific/Kanton',
    'Pacific/Ponape': 'Pacific/Pohnpei',
    'Pacific/Truk': 'Pacific/Chuuk',
};

/** Region/City, letters, digits, `_`, `-` and `+` only: rules out offsets and abbreviations. */
const ZONE_SHAPE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/;
/** The fixed-offset zones (`Etc/GMT+5`) are offsets in disguise; only UTC's own names pass. */
const UTC_NAMES = new Set(['utc', 'etc/utc', 'etc/uct', 'etc/universal', 'etc/zulu', 'etc/gmt', 'gmt', 'uct', 'universal', 'zulu']);

const canonicalCache = new Map<string, string | null>();

/**
 * The current IANA name of a zone, or null when it is not one this browser knows, or is an
 * offset or an abbreviation. Case is fixed (`europe/zurich` gives `Europe/Zurich`) and old
 * names become new ones (`Asia/Calcutta` gives `Asia/Kolkata`).
 */
export function canonicalZone(zone: unknown): string | null {
    if (typeof zone !== 'string') return null;
    const raw = zone.trim();
    if (!raw) return null;
    if (canonicalCache.has(raw)) return canonicalCache.get(raw)!;
    let result: string | null = null;
    if (UTC_NAMES.has(raw.toLowerCase())) {
        result = UTC;
    } else if (ZONE_SHAPE.test(raw) && !/^etc\//i.test(raw)) {
        try {
            const resolved = new Intl.DateTimeFormat('en-US', { timeZone: raw }).resolvedOptions().timeZone;
            result = RENAMED[resolved] ?? resolved;
        } catch {
            result = null;
        }
    }
    canonicalCache.set(raw, result);
    return result;
}

/** Whether a value is a zone name this browser knows. */
export function isZone(zone: unknown): zone is string {
    return canonicalZone(zone) !== null;
}

/** The first of the zones given that this browser knows, as its current name, else UTC. */
export function firstZone(...zones: unknown[]): string {
    for (const zone of zones) {
        const known = canonicalZone(zone);
        if (known) return known;
    }
    return UTC;
}

/** The zone this device is set to, or UTC when the browser does not say. */
export function deviceZone(): string {
    try {
        return firstZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
        return UTC;
    }
}

let zoneList: readonly string[] | null = null;

/** Every zone this browser knows, by current name, sorted, with UTC first. */
export function allZones(): readonly string[] {
    if (zoneList) return zoneList;
    let names: string[] = [];
    try {
        names = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
        names = [];
    }
    const zones = new Set<string>();
    for (const name of names) {
        const zone = canonicalZone(name);
        if (zone && zone !== UTC) zones.add(zone);
    }
    zoneList = [UTC, ...[...zones].sort()];
    return zoneList;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
    let formatter = partsCache.get(zone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: zone, hourCycle: 'h23',
            year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
        });
        partsCache.set(zone, formatter);
    }
    return formatter;
}

/** The wall clock in a zone at a moment: year, month (1 to 12), day, hour, minute, second. */
export function wallClock(zone: string, moment: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    const parts: Record<string, number> = {};
    for (const part of partsFormatter(firstZone(zone)).formatToParts(new Date(moment))) {
        if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    return { year: parts['year'], month: parts['month'], day: parts['day'], hour: parts['hour'] % 24, minute: parts['minute'], second: parts['second'] };
}

/**
 * How many minutes a zone is ahead of UTC at a moment: 120 for Zurich in summer, 60 in
 * winter, 330 for Kolkata all year. The offset of that moment, so summer time is right.
 */
export function zoneOffsetMinutes(zone: string, moment: number): number {
    const wall = wallClock(zone, moment);
    const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    return Math.round((asUtc - Math.floor(moment / 1000) * 1000) / 60000);
}

/** The calendar day in a zone at a moment, as `2026-10-24`, for "Today" and day breaks. */
export function zonedDayKey(zone: string, moment: number): string {
    const { year, month, day } = wallClock(zone, moment);
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whole calendar days from one day key to another (`2026-10-23` to `2026-10-24` is 1). */
export function dayKeyDiff(from: string, to: string): number {
    const utc = (key: string) => {
        const [y, m, d] = key.split('-').map(Number);
        return Date.UTC(y, m - 1, d);
    };
    return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** The city a zone is named after, for a label: `Europe/Zurich` gives Zurich, `America/Argentina/Buenos_Aires` gives Buenos Aires. */
export function zoneCity(zone: string): string {
    const name = firstZone(zone);
    if (name === UTC) return UTC;
    return name.slice(name.lastIndexOf('/') + 1).replace(/_/g, ' ');
}

/**
 * A zone as a person reads it in a list: "Zurich, GMT+2" (the offset at that moment, so
 * it says GMT+1 in winter). UTC is just "UTC".
 */
export function zoneLabel(zone: string, moment: number = Date.now(), locale = 'en-US'): string {
    const name = firstZone(zone);
    if (name === UTC) return UTC;
    let offset = '';
    try {
        offset = new Intl.DateTimeFormat(locale, { timeZone: name, timeZoneName: 'shortOffset' })
            .formatToParts(new Date(moment)).find((part) => part.type === 'timeZoneName')?.value ?? '';
    } catch {
        offset = '';
    }
    return offset ? `${zoneCity(name)}, ${offset}` : zoneCity(name);
}
