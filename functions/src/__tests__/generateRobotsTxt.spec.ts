import { describe, it, expect } from 'vitest';
import { renderRobotsTxt } from '../pages/generateRobotsTxt.js';
import { DEFAULT_DISCOVERABILITY, normalizeDiscoverability } from '../shared/discoverability-settings.js';
import { CRAWLERS } from '../shared/crawlers.js';

describe('renderRobotsTxt (docs/discoverability-spec.md, D-D6)', () => {
    it('allows everything and lists no AI groups by default', () => {
        const txt = renderRobotsTxt('https://example.com/', DEFAULT_DISCOVERABILITY);
        expect(txt).toBe([
            'User-agent: *',
            'Allow: /',
            '',
            'Sitemap: https://example.com/sitemap.xml',
            '# LLM-friendly index: https://example.com/llms.txt',
            '',
        ].join('\n'));
    });

    it('adds a Disallow group for each crawler switched off', () => {
        const settings = normalizeDiscoverability({ crawlers: { gptbot: false, ccbot: false, googlebot: true } });
        const txt = renderRobotsTxt('https://example.com', settings);
        expect(txt).toContain('User-agent: GPTBot\nDisallow: /');
        expect(txt).toContain('User-agent: CCBot\nDisallow: /');
        expect(txt).not.toContain('Googlebot');
        expect(txt.indexOf('User-agent: *')).toBeLessThan(txt.indexOf('User-agent: GPTBot'));
    });

    it('omits the llms.txt pointer when the file is switched off', () => {
        const settings = normalizeDiscoverability({ llmsTxt: false });
        expect(renderRobotsTxt('https://example.com', settings)).not.toContain('llms.txt');
    });

    it('knows every registered agent by its exact user-agent token', () => {
        const all = normalizeDiscoverability({ crawlers: Object.fromEntries(CRAWLERS.map(c => [c.id, false])) });
        const txt = renderRobotsTxt('https://example.com', all);
        for (const agent of CRAWLERS) expect(txt).toContain(`User-agent: ${agent.userAgent}\n`);
    });
});

describe('normalizeDiscoverability', () => {
    it('fills defaults and drops unknown crawler ids', () => {
        const s = normalizeDiscoverability({ crawlers: { gptbot: false, 'made-up': false, ccbot: 'no' }, indexNow: { key: 'k' } });
        expect(s.crawlers['gptbot']).toBe(false);
        expect(s.crawlers['ccbot']).toBe(true);
        expect(s.crawlers).not.toHaveProperty('made-up');
        expect(s.llmsTxt).toBe(true);
        expect(s.indexNow).toEqual({ enabled: true, key: 'k' });
        expect(s.defaultAuthorId).toBe('');
    });

    it('treats junk as defaults', () => {
        expect(normalizeDiscoverability(null).llmsTxt).toBe(true);
        expect(normalizeDiscoverability('x').indexNow.enabled).toBe(true);
    });
});
