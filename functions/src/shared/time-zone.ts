/**
 * The site's time zone on the server (specs/clock-and-zones-spec.md, T-D18;
 * docs/app/clock-and-zones.html): `timeZone` on Settings/localization, an IANA name
 * such as `Europe/Zurich`. Dates the publish functions write into pages use it, so an
 * article published at 00:30 in Zurich shows that day, not the day before in UTC.
 *
 * The same rule as canonicalZone() in src/app/core/time/zones.ts, which writes the
 * value: a Region/City name the runtime knows, never an offset or an abbreviation.
 */

export const UTC = 'UTC';

const ZONE_SHAPE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/;

/** The zone if it is one the runtime knows, else null. */
export function validTimeZone(zone: unknown): string | null {
    if (typeof zone !== 'string') return null;
    const name = zone.trim();
    if (name.toUpperCase() === UTC) return UTC;
    if (!ZONE_SHAPE.test(name) || /^etc\//i.test(name)) return null;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: name });
        return name;
    } catch {
        return null;
    }
}

/** The zone dates on published pages use: the site's (Settings/localization), else UTC. */
export function siteTimeZone(settings: { timeZone?: unknown } | null | undefined): string {
    return validTimeZone(settings?.timeZone) ?? UTC;
}
