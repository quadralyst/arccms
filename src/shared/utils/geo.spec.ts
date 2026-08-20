import {
    DEFAULT_MAP_ZOOM,
    directionsUrl,
    isValidCoordinate,
    mapBoundingBox,
    mapEmbedUrl,
    mapViewUrl,
    parseCoordinatePair,
    renderLocation,
} from './geo';
import { renderLocation as renderServerSide } from '../../../functions/src/shared/geo';

const PUNE = { lat: 18.5204, lng: 73.8567 };

describe('geo', () => {
    describe('isValidCoordinate', () => {
        it.each([
            ['a normal point', 18.5204, 73.8567, true],
            ['null island', 0, 0, true],
            ['the poles', 90, 180, true],
            ['the other corner', -90, -180, true],
            ['latitude past the pole', 91, 0, false],
            ['longitude past the meridian', 0, 181, false],
            ['strings', '18.5' as any, '73.8' as any, false],
            ['NaN', NaN, 0, false],
            ['Infinity', Infinity, 0, false],
            ['null', null as any, null as any, false],
        ])('%s', (_label, lat, lng, expected) => {
            expect(isValidCoordinate(lat, lng)).toBe(expected);
        });
    });

    describe('parseCoordinatePair', () => {
        it('accepts a pasted pair', () => {
            // Editors paste this straight out of another map more often than
            // they type two numbers.
            expect(parseCoordinatePair('18.5204, 73.8567')).toEqual(PUNE);
        });

        it('tolerates loose spacing', () => {
            expect(parseCoordinatePair('  18.5204,73.8567 ')).toEqual(PUNE);
        });

        it('accepts negatives', () => {
            expect(parseCoordinatePair('-33.8688, 151.2093')).toEqual({ lat: -33.8688, lng: 151.2093 });
        });

        it.each(['', 'not coordinates', '18.5204', '18.5204, 73.8567, 5', '999, 999'])(
            'rejects %s', (input) => {
                expect(parseCoordinatePair(input)).toBeNull();
            });
    });

    describe('mapBoundingBox', () => {
        it('surrounds the point', () => {
            const [minLon, minLat, maxLon, maxLat] = mapBoundingBox(PUNE.lat, PUNE.lng);

            expect(minLon).toBeLessThan(PUNE.lng);
            expect(maxLon).toBeGreaterThan(PUNE.lng);
            expect(minLat).toBeLessThan(PUNE.lat);
            expect(maxLat).toBeGreaterThan(PUNE.lat);
        });

        it('gets tighter as the zoom increases', () => {
            const wide = mapBoundingBox(PUNE.lat, PUNE.lng, 10);
            const close = mapBoundingBox(PUNE.lat, PUNE.lng, 18);

            expect(close[2] - close[0]).toBeLessThan(wide[2] - wide[0]);
        });

        it('narrows latitude towards the poles', () => {
            // A degree of longitude shrinks with latitude; without the cosine
            // the box would look stretched far from the equator.
            const equator = mapBoundingBox(0, 0);
            const north = mapBoundingBox(70, 0);

            expect(north[3] - north[1]).toBeLessThan(equator[3] - equator[1]);
        });

        it('clamps an absurd zoom rather than producing a broken box', () => {
            const tooFar = mapBoundingBox(PUNE.lat, PUNE.lng, 999);
            expect(Number.isFinite(tooFar[0])).toBe(true);
            expect(tooFar[2]).toBeGreaterThan(tooFar[0]);
        });
    });

    describe('mapEmbedUrl', () => {
        it('points at OpenStreetMap with a marker and no key', () => {
            const url = mapEmbedUrl(PUNE.lat, PUNE.lng);

            // Keyless is the whole point — a published page loads this in an
            // iframe with no script and no API account.
            expect(url).toContain('openstreetmap.org/export/embed.html');
            expect(url).toContain('marker=18.5204%2C73.8567');
            expect(url).toContain('bbox=');
            expect(url).not.toMatch(/key=|token=|apiKey/i);
        });

        it('encodes the bbox as a single parameter', () => {
            const url = mapEmbedUrl(PUNE.lat, PUNE.lng);
            // Unencoded commas would split the value and break the frame.
            expect(url).toMatch(/bbox=[-\d.]+%2C[-\d.]+%2C[-\d.]+%2C[-\d.]+/);
        });
    });

    describe('directionsUrl', () => {
        it('links to a maps app rather than embedding one', () => {
            // A link is followed on click, so it sets no cookies on page load —
            // which is why the map itself is OSM but directions are not.
            expect(directionsUrl(PUNE.lat, PUNE.lng))
                .toBe('https://www.google.com/maps/dir/?api=1&destination=18.5204%2C73.8567');
        });
    });

    describe('mapViewUrl', () => {
        it('opens the point on OpenStreetMap', () => {
            expect(mapViewUrl(PUNE.lat, PUNE.lng, 15))
                .toBe('https://www.openstreetmap.org/?mlat=18.5204&mlon=73.8567#map=15/18.5204/73.8567');
        });
    });

    describe('renderLocation', () => {
        it('returns all three URLs for a valid point', () => {
            const rendered = renderLocation(PUNE.lat, PUNE.lng, 16);

            expect(rendered?.embed).toContain('openstreetmap.org/export/embed.html');
            expect(rendered?.directions).toContain('google.com/maps/dir');
            expect(rendered?.view).toContain('openstreetmap.org/?mlat=');
        });

        it('returns null when there is no usable point', () => {
            // A row where the editor never placed a marker must render nothing,
            // not a map of the Atlantic.
            expect(renderLocation(null, null)).toBeNull();
            expect(renderLocation(undefined, undefined)).toBeNull();
            expect(renderLocation('18.5' as any, '73.8' as any)).toBeNull();
            expect(renderLocation(200, 200)).toBeNull();
        });

        it('still renders the real place at 0,0', () => {
            // Null Island is a valid coordinate; only *missing* is not.
            expect(renderLocation(0, 0)).not.toBeNull();
        });

        it('falls back to the default zoom', () => {
            expect(renderLocation(PUNE.lat, PUNE.lng)?.embed)
                .toBe(mapEmbedUrl(PUNE.lat, PUNE.lng, DEFAULT_MAP_ZOOM));
        });
    });

    /**
     * The Cloud Functions build cannot import from src/, so this logic exists
     * twice. Publishing uses the server copy and the preview uses this one — if
     * they drift, a published map differs from the previewed one.
     */
    describe('parity with the Cloud Functions mirror', () => {
        it.each([
            ['Pune', PUNE.lat, PUNE.lng, 15],
            ['Null Island', 0, 0, 12],
            ['far south', -33.8688, 151.2093, 18],
            ['high latitude', 70.1234, 25.5678, 10],
        ])('agrees on %s', (_label, lat, lng, zoom) => {
            expect(renderServerSide(lat, lng, zoom)).toEqual(renderLocation(lat, lng, zoom));
        });

        it('agrees that a missing point renders nothing', () => {
            expect(renderServerSide(null, null)).toBeNull();
        });
    });
});
