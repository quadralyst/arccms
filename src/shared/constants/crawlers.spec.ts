import { describe, it, expect } from 'vitest';
import { CRAWLERS as CLIENT, DEFAULT_CRAWLER_POLICY } from './crawlers';
import { CRAWLERS as SERVER } from '../../../functions/src/shared/crawlers';

describe('crawler registry', () => {
    it('is identical on the client and the server', () => {
        expect(CLIENT).toEqual(SERVER);
    });

    it('has unique ids and user agents', () => {
        expect(new Set(CLIENT.map(c => c.id)).size).toBe(CLIENT.length);
        expect(new Set(CLIENT.map(c => c.userAgent)).size).toBe(CLIENT.length);
    });

    it('allows everything by default', () => {
        expect(Object.values(DEFAULT_CRAWLER_POLICY).every(Boolean)).toBe(true);
        expect(Object.keys(DEFAULT_CRAWLER_POLICY).length).toBe(CLIENT.length);
    });
});
