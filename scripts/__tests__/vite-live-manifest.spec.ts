/**
 * The dev server's copy of the live site's manifest (scripts/vite-arc-site.ts), which
 * the admin compares with the local site files (src/app/core/site/site-drift.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { liveManifestResponse, liveManifestUrl } from '../vite-arc-site';

const reply = (status: number, text: string) => vi.fn().mockResolvedValue({ ok: status === 200, status, text: async () => text });

describe('live site manifest', () => {
    it('fetches only a hosting site\'s manifest', () => {
        expect(liveManifestUrl('acme-arccms')).toBe('https://acme-arccms.web.app/_site/site.json');
        expect(liveManifestUrl('evil.com/x')).toBeNull();
        expect(liveManifestUrl('')).toBeNull();
    });

    it('passes the live manifest on', async () => {
        const fetchMock = reply(200, '{"version":1,"files":{"_site/home.html":"h"}}');
        const res = await liveManifestResponse('acme', fetchMock);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).files).toEqual({ '_site/home.html': 'h' });
        expect(fetchMock).toHaveBeenCalledWith('https://acme.web.app/_site/site.json', { cache: 'no-store' });
    });

    it('says the live site has none when it answers with the app shell or a 404', async () => {
        expect((await liveManifestResponse('acme', reply(200, '<!doctype html><arc-root>'))).status).toBe(404);
        expect((await liveManifestResponse('acme', reply(404, 'Not found'))).status).toBe(404);
    });

    it('reports an unreachable site and refuses a bad name', async () => {
        expect((await liveManifestResponse('acme', vi.fn().mockRejectedValue(new Error('offline')))).status).toBe(502);
        expect((await liveManifestResponse('a/b', reply(200, '{}'))).status).toBe(400);
    });
});
