/**
 * The website deploy that keeps the published pages (scripts/arc-hosting-release.mjs).
 */
import { describe, expect, it, vi } from 'vitest';
import {
    channelDeployArgs, hostingSiteOf, keptPublishedFiles, releaseKeepingPublished, versionFiles, withoutHosting,
} from '../arc-hosting-release.mjs';

describe('which live files a website deploy keeps', () => {
    const build = { '/index.html': 'shell', '/__shell.html': 'shell', '/assets/app-new.js': 'n', '/_site/home.html': 'h', '/404.html': 'e' };

    it('keeps published pages, feeds and SEO files, in every language', () => {
        const live = {
            '/articles/post.html': 'p', '/articles/index.html': 'l', '/articles/post.md': 'm', '/articles/feed.xml': 'f',
            '/hi/articles/post.html': 'ph', '/pages/terms/index.html': 't', '/sitemap.xml': 's', '/robots.txt': 'r',
            '/llms.txt': 'x', '/0123abcd.txt': 'k',
        };
        expect(keptPublishedFiles({ live, build })).toEqual(live);
    });

    it('lets the build win, and leaves an older build\'s files behind', () => {
        const live = { '/404.html': 'old-e', '/assets/app-old.js': 'o', '/_site/old.html': 'o', '/site/logo.png': 'o', '/workbox-1a2b.js': 'w', '/sw.js': 's', '/manifest.webmanifest': 'm' };
        expect(keptPublishedFiles({ live, build })).toEqual({});
    });

    it('keeps a published home page over the build\'s app shell, but not an older build\'s copy', () => {
        const live = { '/index.html': 'home', '/hi/index.html': 'home-hi', '/ta/index.html': 'prerendered' };
        expect(keptPublishedFiles({ live, build, publishedHomes: new Set(['/index.html', '/hi/index.html']) }))
            .toEqual({ '/index.html': 'home', '/hi/index.html': 'home-hi' });
    });

    it('drops a published static page the site no longer has', () => {
        const live = { '/pages/terms/index.html': 't', '/pages/old-offer/index.html': 'o' };
        expect(keptPublishedFiles({ live, build, pages: { terms: 'app' } })).toEqual({ '/pages/terms/index.html': 't' });
    });
});

describe('deploy arguments', () => {
    it('sends everything but the website through firebase deploy', () => {
        expect(withoutHosting(['--project', 'p'])).toEqual(['--project', 'p', '--except', 'hosting']);
        expect(withoutHosting(['--only', 'functions,hosting,firestore:rules'])).toEqual(['--only', 'functions,firestore:rules']);
        expect(withoutHosting(['--only=hosting,functions:arccms:arccms.a'])).toEqual(['--only=functions:arccms:arccms.a']);
        expect(withoutHosting(['--only', 'hosting', '--project', 'p'])).toBeNull();
    });

    it('uploads the build to the deploy channel without touching sign-in domains', () => {
        expect(channelDeployArgs({ projectId: 'p', configPath: 'firebase.p.json' }))
            .toEqual(['hosting:channel:deploy', 'arc-deploy', '--expires', '1h', '--no-authorized-domains', '--config', 'firebase.p.json', '--project', 'p']);
    });

    it('finds the site in the config, else the project\'s default site', () => {
        expect(hostingSiteOf({ hosting: { site: 'acme-arccms' } }, 'acme')).toBe('acme-arccms');
        expect(hostingSiteOf({ hosting: { public: 'dist' } }, 'acme')).toBe('acme');
    });
});

/** A fake Hosting API: answers by method and path, records the calls. */
function fakeApi(answers: Record<string, unknown>) {
    const calls: { method: string; path: string; body?: any }[] = [];
    const api = vi.fn(async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        const key = `${method} ${path.split('?')[0]}`;
        const answer = answers[`${method} ${path}`] ?? answers[key];
        if (answer instanceof Error) throw answer;
        return answer ?? {};
    });
    return { api, calls };
}

describe('the live release', () => {
    it('reads every page of a version\'s files', async () => {
        const { api } = fakeApi({
            'GET v1/files?pageSize=1000': { files: [{ path: '/a', hash: '1' }], nextPageToken: 't' },
            'GET v1/files?pageSize=1000&pageToken=t': { files: [{ path: '/b', hash: '2' }] },
        });
        expect(await versionFiles(api, 'v1')).toEqual({ '/a': '1', '/b': '2' });
    });

    function setUp(extra: Record<string, unknown> = {}) {
        return fakeApi({
            'GET sites/s/channels/arc-deploy': { url: 'https://s--arc-deploy-x.web.app', release: { version: { name: 'sites/s/versions/build' } } },
            'GET sites/s/versions/build': { config: { cleanUrls: true } },
            'GET sites/s/versions/build/files': { files: [{ path: '/index.html', hash: 'shell' }, { path: '/assets/a.js', hash: 'a' }] },
            'GET sites/s/releases': { releases: [{ version: { name: 'sites/s/versions/live' } }] },
            'GET sites/s/versions/live/files': { files: [{ path: '/index.html', hash: 'home' }, { path: '/articles/p.html', hash: 'p' }, { path: '/assets/old.js', hash: 'o' }] },
            'POST sites/s/versions': { name: 'sites/s/versions/new' },
            'POST sites/s/versions/new:populateFiles': { uploadRequiredHashes: [] },
            ...extra,
        });
    }
    const site = (home: string) => vi.fn(async (url: string) => ({
        ok: true,
        text: async () => (url.includes('/_site/') ? '' : home),
        json: async () => ({ pages: {} }),
    }));

    it('releases the build with the published pages, in one new version with the build\'s config', async () => {
        const { api, calls } = setUp();
        const result = await releaseKeepingPublished({ site: 's', api, fetchImpl: site('<meta name="arc-deployed-at" content="x">'), log: () => {} });
        expect(result.kept).toBe(2);
        expect(calls.find((c) => c.path === 'sites/s/versions')!.body).toEqual({ config: { cleanUrls: true } });
        expect(calls.find((c) => c.path.endsWith(':populateFiles'))!.body.files).toEqual({ '/index.html': 'home', '/assets/a.js': 'a', '/articles/p.html': 'p' });
        expect(calls.some((c) => c.method === 'PATCH' && c.body.status === 'FINALIZED')).toBe(true);
        expect(calls.at(-1)!.path).toBe('sites/s/releases?versionName=sites%2Fs%2Fversions%2Fnew');
    });

    it('uses the build\'s app shell when the live home page is not a published page', async () => {
        const { api, calls } = setUp();
        await releaseKeepingPublished({ site: 's', api, fetchImpl: site('<arc-root></arc-root>'), log: () => {} });
        expect(calls.find((c) => c.path.endsWith(':populateFiles'))!.body.files['/index.html']).toBe('shell');
    });

    it('releases nothing when Hosting would need files uploaded again', async () => {
        const { api, calls } = setUp({ 'POST sites/s/versions/new:populateFiles': { uploadRequiredHashes: ['x'] } });
        await expect(releaseKeepingPublished({ site: 's', api, fetchImpl: site(''), log: () => {} })).rejects.toThrow('nothing was released');
        expect(calls.some((c) => c.path.includes('/releases?versionName'))).toBe(false);
    });
});
