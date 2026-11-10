import { describe, expect, it } from 'vitest';
import { isSitePath } from './site-path';

describe('isSitePath', () => {
    it('takes a path on this site', () => {
        expect(isSitePath('/')).toBe(true);
        expect(isSitePath('/pricing')).toBe(true);
        expect(isSitePath('/blog/a-post?ref=x#top')).toBe(true);
    });

    it('refuses an address that leaves the site', () => {
        for (const value of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', 'https://evil.example', 'javascript:alert(1)', 'pricing', '']) {
            expect(isSitePath(value)).toBe(false);
        }
    });

    it('refuses what is not text', () => {
        expect(isSitePath(undefined)).toBe(false);
        expect(isSitePath(null)).toBe(false);
        expect(isSitePath(42)).toBe(false);
    });
});
