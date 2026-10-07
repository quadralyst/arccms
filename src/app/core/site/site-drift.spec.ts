/**
 * The local-differs guard (site-drift.ts, specs/own-website-spec.md section 8).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveSiteName, siteFileDrift, SiteDriftService, LIVE_MANIFEST_PATH, NO_LIVE_SITE_FILES } from './site-drift';
import { setSiteManifestForTesting, siteManifest } from './site';

// A project of its own: the shipped environment.ts names none (docs/app/environments.html).
vi.mock('../../../environments/environment', () => ({ environment: { production: false, firebaseConfig: { projectId: 'acme' } } }));

describe('site drift', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        setSiteManifestForTesting();
    });

    it('finds the install\'s hosting site: its own, the project\'s default one, or none', () => {
        expect(liveSiteName({ hostingSite: 'acme-arccms' }, 'acme')).toBe('acme-arccms');
        expect(liveSiteName({ hostingSite: '' }, 'acme')).toBe('acme');
        expect(liveSiteName({ hostingSite: 'none' }, 'acme')).toBeNull();
    });

    it('lists the files that differ or exist on one side only', () => {
        expect(siteFileDrift(
            { '_site/header.html': 'a', '_site/home.html': 'b', '_site/pages/terms.html': 'c' },
            { '_site/header.html': 'a', '_site/home.html': 'x', 'assets/css/site.css': 'd' },
        )).toEqual(['_site/home.html', '_site/pages/terms.html', 'assets/css/site.css']);
        expect(siteFileDrift({ a: '1' }, { a: '1' })).toEqual([]);
    });

    function serve(status: number, body: unknown): ReturnType<typeof vi.fn> {
        const fetchMock = vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => body });
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    it('compares this build\'s files with the live site\'s, through the dev server, once', async () => {
        setSiteManifestForTesting({ ...siteManifest(), files: { '_site/home.html': 'new' } });
        const fetchMock = serve(200, { files: { '_site/home.html': 'old' } });
        const service = new SiteDriftService();
        expect(await service.differences()).toEqual(['_site/home.html']);
        await service.differences();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toMatch(new RegExp(`^${LIVE_MANIFEST_PATH}\\?site=`));
    });

    it('says when the live site has no site files at all', async () => {
        serve(404, { missing: true });
        expect(await new SiteDriftService().differences()).toEqual([NO_LIVE_SITE_FILES]);
    });

    it('says nothing when the live site cannot be reached, or the dev server has no such address', async () => {
        serve(502, { error: 'down' });
        expect(await new SiteDriftService().differences()).toEqual([]);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('html'); } }));
        expect(await new SiteDriftService().differences()).toEqual([]);
    });
});
