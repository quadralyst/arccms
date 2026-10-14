/**
 * Tests for the Hosting release lock (pages/hosting-release-lock.ts).
 *
 * Every release builds its version from the live version's file list. Two
 * releases at once (separate queue items: an entry publish and an items-from
 * rebuild, say) both start from the same version, so the one released last
 * drops what the other added. These run real deployBatchToHosting calls
 * against an in-memory Firestore and a fake Hosting API that keeps versions
 * and releases, and check what is live at the end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── In-memory Firestore: create / get / set / update / delete with lastUpdateTime ──

const { store, firestore } = vi.hoisted(() => {
    const store = new Map<string, { data: Record<string, any>; updateTime: number }>();
    let clock = 0;
    const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
    const fail = (code: number, message: string) => Object.assign(new Error(message), { code });
    function docRef(path: string): any {
        return {
            path,
            async create(data: Record<string, any>) {
                await tick();
                if (store.has(path)) throw fail(6, `6 ALREADY_EXISTS: ${path}`);
                store.set(path, { data: { ...data }, updateTime: ++clock });
            },
            async get() {
                await tick();
                const doc = store.get(path);
                return { exists: !!doc, data: () => (doc ? { ...doc.data } : undefined), updateTime: doc?.updateTime };
            },
            async set(data: Record<string, any>) {
                await tick();
                store.set(path, { data: { ...data }, updateTime: ++clock });
            },
            async update(data: Record<string, any>) {
                await tick();
                const doc = store.get(path);
                if (!doc) throw fail(5, `5 NOT_FOUND: ${path}`);
                store.set(path, { data: { ...doc.data, ...data }, updateTime: ++clock });
            },
            async delete(precondition?: { lastUpdateTime?: number }) {
                await tick();
                const doc = store.get(path);
                if (precondition?.lastUpdateTime !== undefined && doc?.updateTime !== precondition.lastUpdateTime) {
                    throw fail(9, `9 FAILED_PRECONDITION: ${path}`);
                }
                store.delete(path);
            },
            collection: (name: string) => collectionRef(`${path}/${name}`),
        };
    }
    function collectionRef(path: string): any {
        let auto = 0;
        return {
            doc: (id: string) => docRef(`${path}/${id}`),
            add: async (data: Record<string, any>) => {
                const ref = docRef(`${path}/auto-${++auto}-${Math.random()}`);
                await ref.set(data);
                return ref;
            },
        };
    }
    return { store, firestore: { collection: collectionRef } };
});

vi.mock('../init', () => ({ db: firestore }));

vi.mock('google-auth-library', () => ({
    GoogleAuth: function () {
        return { getClient: async () => ({ getAccessToken: async () => ({ token: 't' }) }) };
    },
}));

import { HostingBatch, deployBatchToHosting, removeFileFromHosting } from '../pages/deployToHosting.js';
import { deploySeoFileToHosting } from '../pages/deploySeoFile.js';
import { RELEASE_LOCK_STALE_MS, RELEASE_LOCK_WAIT_MS, RELEASE_TIME_MS, lockWaitBefore, newerVersion } from '../pages/hosting-release-lock.js';

// ─── Fake Hosting API: versions with their files, releases in order ───────────

const SITE = 'my-site';
const LOCK = `_hosting_releases/${SITE}~lock`;

interface FakeHosting {
    versions: Map<string, Record<string, string>>;
    releases: Array<{ version: { name: string }; releaseTime: string }>;
    /** How many of the newest releases the release list does not show yet. */
    listLag: number;
    /** Paused releases: each waits here until resumed. */
    gate: Promise<void> | null;
}

let hosting: FakeHosting;
let versionCount = 0;
let releaseClock = Date.parse('2026-10-14T10:00:00Z');

function json(data: unknown): Response {
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as unknown as Response;
}

/** Settles in a few ms, so concurrent deploys interleave the way they do against the real API. */
const latency = () => new Promise<void>(resolve => setTimeout(resolve, 2));

async function fakeFetch(url: string, init: RequestInit = {}): Promise<Response> {
    await latency();
    const method = init.method ?? 'GET';
    const path = url.replace('https://firebasehosting.googleapis.com/v1beta1/', '');
    if (method === 'GET' && path.startsWith(`sites/${SITE}/releases`)) {
        const shown = hosting.releases.slice(0, Math.max(1, hosting.releases.length - hosting.listLag));
        return json({ releases: shown.slice(-1).reverse() });
    }
    if (method === 'GET' && path.includes('/files?')) {
        const files = hosting.versions.get(path.slice(0, path.indexOf('/files?'))) ?? {};
        return json({ files: Object.entries(files).map(([p, hash]) => ({ path: p, hash })) });
    }
    if (method === 'GET') return json({ config: {} });
    if (method === 'POST' && path === `sites/${SITE}/versions`) {
        const name = `sites/${SITE}/versions/v${++versionCount}`;
        hosting.versions.set(name, {});
        return json({ name });
    }
    if (method === 'POST' && path.endsWith(':populateFiles')) {
        const name = path.slice(0, -':populateFiles'.length);
        hosting.versions.set(name, { ...JSON.parse(String(init.body)).files });
        return json({ uploadRequiredHashes: [], uploadUrl: 'https://upload.example.com' });
    }
    if (method === 'PATCH') return json({ status: 'FINALIZED' });
    if (method === 'POST' && path.startsWith(`sites/${SITE}/releases?versionName=`)) {
        if (hosting.gate) await hosting.gate;
        const release = {
            version: { name: path.slice(`sites/${SITE}/releases?versionName=`.length) },
            releaseTime: new Date(releaseClock += 1000).toISOString(),
        };
        hosting.releases.push(release);
        return json(release);
    }
    throw new Error(`Unexpected Hosting call: ${method} ${path}`);
}

/** The paths the newest release serves (what a visitor sees). */
function livePaths(): string[] {
    const latest = hosting.releases[hosting.releases.length - 1];
    return Object.keys(hosting.versions.get(latest?.version.name ?? '') ?? {}).sort();
}

const publish = (...paths: string[]) => {
    const batch = new HostingBatch();
    for (const p of paths) batch.add(p, `<html>${p}</html>`);
    return deployBatchToHosting(SITE, batch, '', '');
};

beforeEach(() => {
    store.clear();
    hosting = {
        versions: new Map([[`sites/${SITE}/versions/v0`, { '/index.html': 'h0' }]]),
        releases: [{ version: { name: `sites/${SITE}/versions/v0` }, releaseTime: new Date(releaseClock).toISOString() }],
        listLag: 0,
        gate: null,
    };
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Hosting releases run one at a time', () => {
    it('keeps both files live when two releases run at once', async () => {
        // Without the lock both read v0 and the later release drops the other's file.
        const [a, b] = await Promise.all([publish('/articles/a.html'), publish('/products/b.html')]);

        expect(a).toBe(true);
        expect(b).toBe(true);
        expect(livePaths()).toEqual(['/articles/a.html', '/index.html', '/products/b.html']);
    });

    it('keeps every file live when several queue items release at once', async () => {
        const paths = ['/a.html', '/b.html', '/c.html', '/d.html'];
        const results = await Promise.all(paths.map(p => publish(p)));

        expect(results).toEqual([true, true, true, true]);
        expect(livePaths()).toEqual([...paths, '/index.html'].sort());
        expect(store.has(LOCK)).toBe(false);
    });

    it('lets a removal and a publish at once both take effect', async () => {
        hosting.versions.set(`sites/${SITE}/versions/v0`, { '/index.html': 'h0', '/old.html': 'h1' });

        await Promise.all([removeFileFromHosting(SITE, '/old.html'), publish('/new.html')]);

        expect(livePaths()).toEqual(['/index.html', '/new.html']);
    });

    it('builds a waiting release on the one it waited for, even before the release list shows it', async () => {
        // The release list lags one release behind: after the first publish it still shows v0.
        hosting.listLag = 1;

        await publish('/articles/a.html');
        await publish('/products/b.html');

        expect(livePaths()).toEqual(['/articles/a.html', '/index.html', '/products/b.html']);
        expect(store.get(`_hosting_releases/${SITE}`)?.data.version).toBe(hosting.releases[2].version.name);
    });

    it('builds on a newer listed release, such as one from firebase deploy, over the recorded one', async () => {
        await publish('/articles/a.html');
        // A deploy outside Arc CMS releases a version without a.html.
        hosting.versions.set(`sites/${SITE}/versions/cli`, { '/index.html': 'h2' });
        hosting.releases.push({ version: { name: `sites/${SITE}/versions/cli` }, releaseTime: new Date(releaseClock += 1000).toISOString() });

        await publish('/products/b.html');

        expect(livePaths()).toEqual(['/index.html', '/products/b.html']);
    });

    it('removes the lock when the release fails, so the next one is not held up', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 500, text: async () => 'boom' }) as unknown as Response);

        expect(await publish('/a.html')).toBe(false);
        expect(store.has(LOCK)).toBe(false);
        expect(await publish('/b.html')).toBe(true);
        expect(livePaths()).toEqual(['/b.html', '/index.html']);
    });

    it('takes over a lock left by a function that died mid-release', async () => {
        store.set(LOCK, { data: { holder: 'dead', since: Date.now() - RELEASE_LOCK_STALE_MS - 1000 }, updateTime: -1 });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(await publish('/a.html')).toBe(true);

        expect(livePaths()).toEqual(['/a.html', '/index.html']);
        expect(store.has(LOCK)).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('never finished'));
    });

    it('takes over a lock whose start is further in the future than a clock could be off', async () => {
        // A lock that says it was taken an hour from now was not written by a release.
        store.set(LOCK, { data: { holder: 'forged', since: Date.now() + 60 * 60_000 }, updateTime: -1 });
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(await publish('/a.html')).toBe(true);
        expect(livePaths()).toEqual(['/a.html', '/index.html']);
    });

    it('waits for a lock a few seconds ahead, as a clock a little ahead of this one writes', async () => {
        store.set(LOCK, { data: { holder: 'ahead', since: Date.now() + 5_000 }, updateTime: 1 });
        setTimeout(() => store.delete(LOCK), 100);

        expect(await publish('/a.html')).toBe(true);
        expect(hosting.releases).toHaveLength(2);
    });

    it('waits for a live lock rather than releasing past it', async () => {
        let resume!: () => void;
        hosting.gate = new Promise<void>(resolve => { resume = resolve; });
        const first = publish('/a.html');
        // The first release holds the lock and is paused at the release call.
        await vi.waitFor(() => expect(store.has(LOCK)).toBe(true));
        const second = publish('/b.html');
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(hosting.versions.size).toBe(2); // v0 and the first's version: the second has not started
        hosting.gate = null;
        resume();

        expect(await first).toBe(true);
        expect(await second).toBe(true);
        expect(livePaths()).toEqual(['/a.html', '/b.html', '/index.html']);
    });

    it('does not remove a lock another release took over', async () => {
        let resume!: () => void;
        hosting.gate = new Promise<void>(resolve => { resume = resolve; });
        const first = publish('/a.html');
        await vi.waitFor(() => expect(store.has(LOCK)).toBe(true));
        // Another release took the lock over (as if this one had been taken for dead).
        store.set(LOCK, { data: { holder: 'other', since: Date.now() }, updateTime: 999 });
        hosting.gate = null;
        resume();

        await first;
        expect(store.get(LOCK)?.data.holder).toBe('other');
    });

    it('fails with HOSTING_RELEASE_BUSY, releasing nothing, when another release holds the lock too long', async () => {
        const started = Date.now();
        // A live holder, and a clock that moves a minute each time it is read, so
        // the wait runs out after a pause or two, long before the lock is stale.
        store.set(LOCK, { data: { holder: 'busy', since: started }, updateTime: 1 });
        let reads = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => started + (reads++) * 60_000);
        store.set('arc_articles/doc1', { data: {}, updateTime: 1 });

        const released = await deployBatchToHosting(SITE, new HostingBatch().add('/a.html', 'A'), 'arc_articles', 'doc1');

        expect(released).toBe(false);
        expect(reads * 60_000).toBeGreaterThan(RELEASE_LOCK_WAIT_MS);
        expect(store.get('arc_articles/doc1')?.data.deployErrorCode).toBe('HOSTING_RELEASE_BUSY');
        expect(hosting.releases).toHaveLength(1);
        expect(store.get(LOCK)?.data.holder).toBe('busy');
    });
});

// A queue run with a time budget passes a deadline: the wait for the lock must
// not run it past its function's timeout.
describe('a release with a deadline', () => {
    /** A live holder, and a clock that moves a minute each time it is read. */
    function busyClock() {
        const started = Date.now();
        store.set(LOCK, { data: { holder: 'busy', since: started }, updateTime: 1 });
        let reads = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => started + (reads++) * 60_000);
        return { started };
    }

    it('waits for the lock only while the release still fits before the deadline', async () => {
        const { started } = busyClock();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const failures: Array<{ code: string; message: string }> = [];

        const released = await deployBatchToHosting(SITE, new HostingBatch().add('/a.html', 'A'), '', '', {
            deadline: started + RELEASE_TIME_MS + 60_000,
            onFailure: (f) => failures.push(f),
        });

        expect(released).toBe(false);
        expect(failures.map(f => f.code)).toEqual(['HOSTING_RELEASE_BUSY']);
        // Gave up after at most the minute the deadline left, not the full wait.
        const waitedS = Number(/after (\d+) seconds/.exec(failures[0].message)?.[1]);
        expect(waitedS).toBeLessThanOrEqual(60);
        expect(RELEASE_LOCK_WAIT_MS / 1000).toBeGreaterThan(60);
        expect(hosting.releases).toHaveLength(1);
    });

    it('waits once more when asked and the deadline leaves time, recording nothing in between', async () => {
        const { started } = busyClock();
        store.set('arc_articles/doc1', { data: {}, updateTime: 1 });
        // The other release ends just as the first wait runs out.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { store.delete(LOCK); });

        const released = await deployBatchToHosting(SITE, new HostingBatch().add('/a.html', 'A'), 'arc_articles', 'doc1', {
            deadline: started + 60 * 60_000,
            busyRetries: 1,
        });

        expect(released).toBe(true);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('once more'));
        expect(store.get('arc_articles/doc1')?.data).toMatchObject({ deployStatus: 'deployed', deployErrorCode: '' });
        expect(livePaths()).toEqual(['/a.html', '/index.html']);
    });

    it('does not wait again without busyRetries', async () => {
        busyClock();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(await deployBatchToHosting(SITE, new HostingBatch().add('/a.html', 'A'), '', '')).toBe(false);
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('once more'));
    });
});

describe('lockWaitBefore', () => {
    it('is the full wait without a deadline, or with one far enough away', () => {
        expect(lockWaitBefore()).toBe(RELEASE_LOCK_WAIT_MS);
        expect(lockWaitBefore(Date.now() + 60 * 60_000)).toBe(RELEASE_LOCK_WAIT_MS);
    });

    it('leaves the release its time before the deadline, and is never negative', () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        expect(lockWaitBefore(now + RELEASE_TIME_MS + 30_000)).toBe(30_000);
        expect(lockWaitBefore(now + RELEASE_TIME_MS - 1)).toBe(0);
        expect(lockWaitBefore(now - 1)).toBe(0);
    });
});

// An SEO file released on its own (no batch: an app function, or a caller that
// has none) is a release like any other, so it takes the same lock.
describe('an SEO file released on its own', () => {
    beforeEach(() => vi.stubEnv('ARC_HOSTING_SITE', SITE));
    afterEach(() => vi.unstubAllEnvs());

    it('keeps the files of a release running at the same time', async () => {
        await Promise.all([
            publish('/articles/a.html'),
            deploySeoFileToHosting('/robots.txt', 'User-agent: *'),
            deploySeoFileToHosting('/sitemap.xml', '<urlset/>'),
        ]);

        expect(livePaths()).toEqual(['/articles/a.html', '/index.html', '/robots.txt', '/sitemap.xml']);
        expect(store.has(LOCK)).toBe(false);
    });

    it('waits for a live lock, then builds on the release it waited for, even before the list shows it', async () => {
        hosting.listLag = 1;
        let resume!: () => void;
        hosting.gate = new Promise<void>(resolve => { resume = resolve; });
        const first = publish('/a.html');
        await vi.waitFor(() => expect(store.has(LOCK)).toBe(true));
        const seo = deploySeoFileToHosting('/robots.txt', 'User-agent: *');
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(hosting.versions.size).toBe(2); // the SEO release has not started
        hosting.gate = null;
        resume();
        await first;
        await seo;

        expect(livePaths()).toEqual(['/a.html', '/index.html', '/robots.txt']);
    });

    it('throws when its release does not go out, so the caller can report it', async () => {
        vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: false, status: 500, text: async () => 'boom' }) as unknown as Response);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(deploySeoFileToHosting('/robots.txt', 'x')).rejects.toThrow(/robots\.txt.*HOSTING_API_500/);
        expect(store.has(LOCK)).toBe(false);
    });

    it('rides in the caller\'s batch when given one, releasing nothing itself', async () => {
        const batch = new HostingBatch();
        await deploySeoFileToHosting('/robots.txt', 'x', batch);
        expect(batch.paths).toEqual(['/robots.txt']);
        expect(hosting.releases).toHaveLength(1);
    });
});

describe('newerVersion', () => {
    const listed = (name: string, at: string) => ({ version: { name }, releaseTime: at });

    it('uses the listed release when nothing is recorded', () => {
        expect(newerVersion(listed('v1', '2026-10-14T10:00:00Z'), null)).toBe('v1');
    });

    it('uses the recorded release when it is newer than the listed one', () => {
        expect(newerVersion(listed('v1', '2026-10-14T10:00:00Z'), { version: 'v2', releaseTime: '2026-10-14T10:00:05Z' })).toBe('v2');
    });

    it('uses the listed release when it is newer than the recorded one', () => {
        expect(newerVersion(listed('v3', '2026-10-14T10:00:09Z'), { version: 'v2', releaseTime: '2026-10-14T10:00:05Z' })).toBe('v3');
    });

    it('uses the listed release when either time is unknown', () => {
        expect(newerVersion({ version: { name: 'v1' } }, { version: 'v2', releaseTime: '2026-10-14T10:00:05Z' })).toBe('v1');
    });

    it('uses the recorded release when the list shows none yet', () => {
        expect(newerVersion(undefined, { version: 'v1', releaseTime: '2026-10-14T10:00:00Z' })).toBe('v1');
    });
});
