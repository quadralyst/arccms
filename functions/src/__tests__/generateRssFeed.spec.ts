/**
 * The feeds (functions/src/pages/generateRssFeed.ts): an entry keeps its own date, the feed says
 * when it last changed, and an item's description is never cut mid-word.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { deploy, collection } = vi.hoisted(() => ({ deploy: vi.fn(), collection: vi.fn() }));
vi.mock('../init', () => ({ db: { collection } }));
vi.mock('../pages/deploySeoFile', () => ({ deploySeoFileToHosting: deploy }));
vi.mock('../shared/site-settings', () => ({ getSiteConfig: async () => ({ siteName: 'Example', baseUrl: 'https://example.com' }) }));

import { generateAndDeployRssFeeds, getExcerpt } from '../pages/generateRssFeed.js';

const at = (iso: string) => ({ seconds: Date.parse(iso) / 1000 });
const feed = async (items: Record<string, unknown>[]): Promise<string> => {
    collection.mockImplementation((name: string) => {
        const docs = name === 'ContentTypes' ? [{ id: 't', data: () => ({ slug: 'articles', name: 'Articles' }) }] : items.map((item) => ({ data: () => item }));
        const result = { get: async () => ({ empty: !docs.length, docs }), limit: () => result, orderBy: () => result };
        return result;
    });
    await generateAndDeployRssFeeds();
    return deploy.mock.calls.map((call) => call.find((arg: unknown) => typeof arg === 'string' && arg.includes('<rss'))).pop();
};

describe('generateAndDeployRssFeeds', () => {
    beforeEach(() => vi.clearAllMocks());

    it('an entry published again keeps its date, and the feed was built at the last publish of any', async () => {
        const xml = await feed([
            { title: 'New', urlSlug: 'new', publishedOn: at('2026-03-02T00:00:00Z'), lastPublishedAt: at('2026-03-02T00:00:00Z') },
            { title: 'Old', urlSlug: 'old', publishedOn: at('2026-01-01T00:00:00Z'), lastPublishedAt: at('2026-04-05T00:00:00Z') },
        ]);
        expect(xml).toContain('<pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate>');
        expect(xml).toContain('<lastBuildDate>Sun, 05 Apr 2026 00:00:00 GMT</lastBuildDate>');
    });

    it('works from the publish dates alone for entries from before it was kept', async () => {
        expect(await feed([{ title: 'A', urlSlug: 'a', publishedOn: at('2026-03-02T00:00:00Z') }])).toContain('<lastBuildDate>Mon, 02 Mar 2026 00:00:00 GMT</lastBuildDate>');
    });

    it('is built now when it is empty', async () => {
        expect(await feed([])).toMatch(/<lastBuildDate>.+GMT<\/lastBuildDate>/);
    });
});

describe('a feed item\'s description', () => {
    it('is the meta description or summary, cut at a word to 200 characters', () => {
        expect(getExcerpt({ metaDescription: 'Meta.', summary: 'Summary.' })).toBe('Meta.');
        expect(getExcerpt({ summary: 'Tom &amp; Jerry.' })).toBe('Tom & Jerry.');
        const long = getExcerpt({ summary: 'gardening '.repeat(40) });
        expect(long.endsWith('gardening...')).toBe(true);
        expect(long.length).toBeLessThanOrEqual(200);
    });

    it('is the body\'s automatic summary when neither is written: whole sentences, blocks kept apart', () => {
        const content = `<h3>Key takeaways</h3><p>A small garden grows best with sun for most of the day. ${'More words follow here. '.repeat(10)}</p>`;
        expect(getExcerpt({ content })).toBe('Key takeaways A small garden grows best with sun for most of the day. More words follow here. More words follow here. More words follow here.');
    });

    it('is escaped in the feed once, not twice', async () => {
        expect(await feed([{ title: 'A', urlSlug: 'a', summary: 'Fish &amp; chips' }])).toContain('<description>Fish &amp; chips</description>');
    });
});
