import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDocGet, mockDocSet, mockFetch, mockGetSiteConfig } = vi.hoisted(() => ({
    mockDocGet: vi.fn(),
    mockDocSet: vi.fn(),
    mockFetch: vi.fn(),
    mockGetSiteConfig: vi.fn(),
}));

vi.mock('../init', () => ({
    db: { doc: vi.fn(() => ({ get: mockDocGet, set: mockDocSet })), collection: vi.fn() },
}));
vi.mock('../shared/site-settings', () => ({
    getSiteConfig: mockGetSiteConfig,
    getAboutConfig: vi.fn(),
    getLocalizationSettings: vi.fn(),
}));
vi.stubGlobal('fetch', mockFetch);

import {
    LLMS_FULL_MAX_BYTES,
    LLMS_TXT_MAX_LINKS,
    renderLlmsFullTxt,
    renderLlmsTxt,
    type LlmsSiteInput,
} from '../pages/generateLlmsTxt.js';
import {
    ensureIndexNowKey,
    generateIndexNowKey,
    submitToIndexNow,
    urlsForIndexNow,
} from '../pages/indexNow.js';
import { clearDiscoverabilityCache } from '../shared/discoverability-settings.js';
import { HostingBatch } from '../pages/deployToHosting.js';

function page(i: number, extra: Partial<LlmsSiteInput['sections'][0]['pages'][0]> = {}) {
    return {
        title: `Post ${i}`,
        url: `https://x.com/articles/post-${i}`,
        markdownUrl: `https://x.com/articles/post-${i}.md`,
        summary: `Summary ${i}`,
        sortAt: i,
        markdown: `# Post ${i}\n\nBody ${i}\n`,
        ...extra,
    };
}

const SITE: LlmsSiteInput = {
    siteName: 'Acme',
    baseUrl: 'https://x.com',
    description: 'Acme builds things.',
    sections: [
        { name: 'Articles', description: 'Blog posts', listUrl: 'https://x.com/articles', pages: [page(1), page(3), page(2)] },
        { name: 'Manuals', description: '', listUrl: 'https://x.com/manuals', pages: [] },
    ],
};

describe('renderLlmsTxt (D-D7)', () => {
    it('follows the llms.txt shape: H1, blockquote, H2 sections, newest first, Markdown links', () => {
        const txt = renderLlmsTxt(SITE);
        expect(txt.startsWith('# Acme\n\n> Acme builds things.\n\n')).toBe(true);
        expect(txt).toContain('## Articles\n\nBlog posts\n\n- [Post 3](https://x.com/articles/post-3.md): Summary 3\n- [Post 2](https://x.com/articles/post-2.md): Summary 2\n- [Post 1](https://x.com/articles/post-1.md): Summary 1\n');
        expect(txt).not.toContain('## Manuals');
        expect(txt).toContain('## Optional\n\n- [Sitemap](https://x.com/sitemap.xml)');
    });

    it('caps the number of links', () => {
        const many = { ...SITE, sections: [{ ...SITE.sections[0], pages: Array.from({ length: LLMS_TXT_MAX_LINKS + 50 }, (_, i) => page(i)) }] };
        const links = renderLlmsTxt(many).match(/^- \[Post/gm) || [];
        expect(links.length).toBe(LLMS_TXT_MAX_LINKS);
    });
});

describe('renderLlmsFullTxt (D-D7)', () => {
    it('concatenates twins newest first with separators', () => {
        const txt = renderLlmsFullTxt(SITE);
        expect(txt.startsWith('# Acme\n\n> Acme builds things.\n\n')).toBe(true);
        expect(txt.indexOf('# Post 3')).toBeLessThan(txt.indexOf('# Post 2'));
        expect(txt.match(/\n---\n/g)?.length).toBe(3);
    });

    it('stops before the size cap', () => {
        const big = 'x'.repeat(LLMS_FULL_MAX_BYTES / 2);
        const site = { ...SITE, sections: [{ ...SITE.sections[0], pages: [page(1, { markdown: big }), page(2, { markdown: big }), page(3, { markdown: big })] }] };
        const txt = renderLlmsFullTxt(site);
        expect(Buffer.byteLength(txt)).toBeLessThanOrEqual(LLMS_FULL_MAX_BYTES);
        expect(txt.match(/\n---\n/g)?.length).toBe(1);
    });
});

describe('IndexNow (D-D9)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearDiscoverabilityCache();
        mockGetSiteConfig.mockResolvedValue({ siteName: 'Acme', baseUrl: 'https://x.com/', cssUrls: [] });
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ indexNow: { enabled: true, key: 'abc123' } }) });
        mockDocSet.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue({ status: 202, text: async () => '' });
    });

    it('maps batch paths to clean public URLs, HTML pages only, de-duplicated', () => {
        const urls = urlsForIndexNow('https://x.com/', [
            '/articles/hello.html', '/articles/hello.md', '/articles/index.html', '/hi/articles/hello.html',
            '/sitemap.xml', '/robots.txt', '/llms.txt', '/__shell.html', '/pages/privacy/index.html',
        ], ['/articles/gone.html', '/articles/hello.html']);
        expect(urls).toEqual([
            'https://x.com/articles/hello',
            'https://x.com/articles',
            'https://x.com/hi/articles/hello',
            'https://x.com/articles/gone',
        ]);
    });

    it('generates a 32-hex key', () => {
        expect(generateIndexNowKey()).toMatch(/^[0-9a-f]{32}$/);
    });

    it('reuses a stored key and queues the key file in the batch', async () => {
        const batch = new HostingBatch();
        const key = await ensureIndexNowKey(batch);
        expect(key).toBe('abc123');
        expect(mockDocSet).not.toHaveBeenCalled();
        expect(batch.files).toEqual([{ path: '/abc123.txt', content: 'abc123' }]);
    });

    it('generates and stores a key when none exists', async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ indexNow: { enabled: true, key: '' } }) });
        const key = await ensureIndexNowKey();
        expect(key).toMatch(/^[0-9a-f]{32}$/);
        expect(mockDocSet).toHaveBeenCalledWith({ indexNow: { enabled: true, key } }, { merge: true });
    });

    it('posts host, key, keyLocation and the URL list', async () => {
        const result = await submitToIndexNow(['https://x.com/articles/hello']);
        expect(result).toEqual({ submitted: 1, status: 202 });
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('https://api.indexnow.org/indexnow');
        expect(JSON.parse(init.body)).toEqual({
            host: 'x.com',
            key: 'abc123',
            keyLocation: 'https://x.com/abc123.txt',
            urlList: ['https://x.com/articles/hello'],
        });
    });

    it('skips when disabled, when there is nothing to send, or without a real base URL', async () => {
        expect(await submitToIndexNow([])).toEqual({ submitted: 0, skipped: 'no-urls' });
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ indexNow: { enabled: false, key: 'k' } }) });
        clearDiscoverabilityCache();
        expect(await submitToIndexNow(['https://x.com/a'])).toEqual({ submitted: 0, skipped: 'disabled' });
        expect(mockFetch).not.toHaveBeenCalled();
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ indexNow: { enabled: true, key: 'k' } }) });
        clearDiscoverabilityCache();
        mockGetSiteConfig.mockResolvedValue({ siteName: 'Acme', baseUrl: '', cssUrls: [] });
        expect(await submitToIndexNow(['https://x.com/a'])).toEqual({ submitted: 0, skipped: 'no-base-url' });
    });

    it('never throws: a rejected fetch or a 4xx is logged and reported', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockFetch.mockRejectedValueOnce(new Error('offline'));
        expect(await submitToIndexNow(['https://x.com/a'])).toEqual({ submitted: 0 });
        mockFetch.mockResolvedValueOnce({ status: 422, text: async () => 'bad key' });
        expect(await submitToIndexNow(['https://x.com/a'])).toEqual({ submitted: 1, status: 422 });
        expect(errorSpy).toHaveBeenCalledTimes(2);
        errorSpy.mockRestore();
    });
});
