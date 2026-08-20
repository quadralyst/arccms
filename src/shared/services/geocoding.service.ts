/**
 * Address lookup for the Map Location field, via OpenStreetMap's Nominatim.
 *
 * Admin-only. A published page never geocodes — it already has coordinates.
 *
 * Nominatim is free and needs no key, which is what keeps this field from
 * requiring an API account and a billing card. In exchange its usage policy
 * asks for restraint, and this service is where that is honoured:
 *
 *   - **One request per search, on demand.** Never search-as-you-type; the
 *     policy forbids autocomplete against the public endpoint.
 *   - **At most one request per second**, enforced below rather than trusted
 *     to the UI.
 *   - **Results are cached** for the session, so re-searching a term the
 *     editor already tried costs nothing.
 *
 * Its answers are also weaker than a paid geocoder — searching "FC Road Pune"
 * returns "Gopal Krushna Gokhale Path", which is that road's official name.
 * Correct, but not what was typed, which is why the picker lets the marker be
 * dragged and the coordinates typed directly.
 */

import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/** Nominatim asks for at least a second between requests. */
const MIN_INTERVAL_MS = 1100;

/** One place Nominatim matched. */
export interface GeocodeResult {
    lat: number;
    lng: number;
    /** The full formatted address, as Nominatim describes the place. */
    address: string;
}

@Injectable({ providedIn: 'root' })
export class GeocodingService {
    private platform = inject(PLATFORM_ID);

    private cache = new Map<string, GeocodeResult[]>();
    private lastRequestAt = 0;

    /**
     * Places matching `query`, best first. Empty when nothing matched.
     *
     * Never throws — a lookup failing is a normal outcome the editor recovers
     * from by dragging the marker, not an error worth interrupting them with.
     */
    async search(query: string, limit = 5): Promise<GeocodeResult[]> {
        const term = query.trim();
        if (!term || !isPlatformBrowser(this.platform)) return [];

        const cacheKey = `${term}|${limit}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        await this.throttle();

        const url = `${NOMINATIM_URL}?q=${encodeURIComponent(term)}&format=jsonv2&limit=${limit}&addressdetails=0`;

        try {
            const response = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!response.ok) return [];

            const raw = (await response.json()) as unknown;
            const results = Array.isArray(raw) ? raw.map(toResult).filter(isResult) : [];

            this.cache.set(cacheKey, results);
            return results;
        } catch (error) {
            console.error('Address lookup failed', error);
            return [];
        }
    }

    /** Spaces requests out to respect the public endpoint's rate limit. */
    private async throttle(): Promise<void> {
        const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        this.lastRequestAt = Date.now();
    }
}

function toResult(entry: unknown): GeocodeResult | null {
    if (!entry || typeof entry !== 'object') return null;
    const row = entry as Record<string, unknown>;

    // Nominatim returns coordinates as strings.
    const lat = Number(row['lat']);
    const lng = Number(row['lon']);
    const address = typeof row['display_name'] === 'string' ? row['display_name'] : '';

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !address) return null;
    return { lat, lng, address };
}

function isResult(value: GeocodeResult | null): value is GeocodeResult {
    return value !== null;
}
