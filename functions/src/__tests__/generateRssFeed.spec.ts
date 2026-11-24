/** The feeds' dates (functions/src/pages/generateRssFeed.ts): an entry keeps its own, the feed says when it last changed. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { deploy, collection } = vi.hoisted(() => ({ deploy: vi.fn(), collection: vi.fn() }));
vi.mock('../init', () => ({ db: { collection } }));
vi.mock('../pages/deploySeoFile', () => ({ deploySeoFileToHosting: deploy }));
vi.mock('../shared/site-settings', () => ({ getSiteConfig: async () => ({ siteName: 'Example', baseUrl: 'https://example.com' }) }));

import { generateAndDeployRssFeeds } from '../pages/generateRssFeed.js';

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
