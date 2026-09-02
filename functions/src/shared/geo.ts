/**
 * Map location handling for the Map Location field (server copy).
 *
 * A stored location is just coordinates and an address. Everything a template
 * needs — the embeddable map URL and the directions link — is derived at
 * render time, so a fix here repairs existing content instead of needing a
 * migration. Same arrangement as the YouTube handling in `youtube.ts`.
 *
 * The published side is deliberately **keyless and script-free**: an
 * OpenStreetMap embed iframe, no API key, no map library, no tracking cookies.
 * Leaflet is used only in the admin, to place the marker.
 *
 * Mirror of src/shared/utils/geo.ts, which is the source of truth — the Cloud
 * Functions build cannot import from src/. A parity spec runs the same points
 * through both, so a change here without one there fails the suite rather than
 * publishing pages that disagree with the preview.
 */

/** A location as stored on a content document. */
export interface MapLocation {
    lat: number;
    lng: number;
    address: string;
    label?: string;
    zoom?: number;
}

/** Neighbourhood level — close enough to place a building, wide enough to orient. */
export const DEFAULT_MAP_ZOOM = 15;

const MIN_ZOOM = 1;
const MAX_ZOOM = 19;

/** True when the pair is a usable point on Earth. */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
    return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
        && typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

/**
 * Parses a coordinate a person typed.
 *
 * Editors paste "18.5204, 73.8567" straight out of another map as often as
 * they type a single number, so both are accepted.
 */
export function parseCoordinatePair(input: string): { lat: number; lng: number } | null {
    const parts = String(input ?? '').split(',').map((p) => Number(p.trim()));
    if (parts.length !== 2) return null;
    return isValidCoordinate(parts[0], parts[1]) ? { lat: parts[0], lng: parts[1] } : null;
}

function clampZoom(zoom: unknown): number {
    const value = typeof zoom === 'number' && Number.isFinite(zoom) ? Math.round(zoom) : DEFAULT_MAP_ZOOM;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/**
 * The bounding box the OSM embed wants, derived from a point and a zoom.
 *
 * The embed takes a box rather than a centre, so one is worked out here.
 * Longitude span comes from the zoom level; latitude is narrowed by
 * `cos(lat)` because a degree of longitude shrinks towards the poles and the
 * box would otherwise look stretched. The embed refits the box to the actual
 * iframe anyway, so this needs to be close, not exact.
 */
export function mapBoundingBox(lat: number, lng: number, zoom = DEFAULT_MAP_ZOOM): [number, number, number, number] {
    const z = clampZoom(zoom);

    // 2.5 tiles wide is roughly a 600px-wide frame at this zoom.
    const lonHalf = (360 / Math.pow(2, z)) * 2.5 / 2;
    const latHalf = lonHalf * 0.65 * Math.cos((lat * Math.PI) / 180);

    return [
        Number((lng - lonHalf).toFixed(6)),
        Number((lat - latHalf).toFixed(6)),
        Number((lng + lonHalf).toFixed(6)),
        Number((lat + latHalf).toFixed(6)),
    ];
}

/**
 * A ready-to-use `<iframe src>` showing the point with a marker.
 *
 * No API key, no script, and OpenStreetMap sets no tracking cookies — which
 * is what keeps a location block out of consent-banner territory.
 */
export function mapEmbedUrl(lat: number, lng: number, zoom = DEFAULT_MAP_ZOOM): string {
    const [minLon, minLat, maxLon, maxLat] = mapBoundingBox(lat, lng, zoom);
    const bbox = encodeURIComponent(`${minLon},${minLat},${maxLon},${maxLat}`);
    const marker = encodeURIComponent(`${lat},${lng}`);
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
}

/**
 * A directions link for the visitor's own maps app.
 *
 * Google rather than OpenStreetMap here, despite the map itself being OSM:
 * this is a plain link with no key and no cookies until someone clicks it, and
 * on a phone it opens the maps app people actually navigate with. OSM's own
 * routing is not a realistic substitute for that.
 */
export function directionsUrl(lat: number, lng: number): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
}

/** A link to view the point on OpenStreetMap itself. */
export function mapViewUrl(lat: number, lng: number, zoom = DEFAULT_MAP_ZOOM): string {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${clampZoom(zoom)}/${lat}/${lng}`;
}

/** Everything a template needs for one location, or null if it has no valid point. */
export interface RenderedLocation {
    embed: string;
    directions: string;
    view: string;
}

export function renderLocation(lat: unknown, lng: unknown, zoom?: unknown): RenderedLocation | null {
    if (!isValidCoordinate(lat, lng)) return null;

    const z = clampZoom(zoom);
    return {
        embed: mapEmbedUrl(lat as number, lng as number, z),
        directions: directionsUrl(lat as number, lng as number),
        view: mapViewUrl(lat as number, lng as number, z),
    };
}
