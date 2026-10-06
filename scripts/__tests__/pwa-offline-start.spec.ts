// @vitest-environment node
/**
 * Starting offline right after an update never opens a blank page
 * (specs/app-pwa-offline-start-spec.md, docs/features/pwa.html).
 *
 * Builds real service workers with workbox-build from Arc CMS's own settings
 * (scripts/pwa-workbox.ts, as vite.config.ts passes them to the PWA plugin) for two
 * deploys of a small app, and runs them with Workbox's real code over stand-ins for the
 * browser: the stored files (Cache Storage), the server and the network. Then: open
 * several addresses on deploy 1, deploy 2, update, go offline, and start at each address.
 * Every page that opens must find each code file it starts with.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { generateSW } from 'workbox-build';
import { currentBuildPages, pwaWorkbox, SHELL_URL } from '../pwa-workbox';
import { routeCode } from '../vite-route-code';
import { resolvePwaConfig } from '../../src/app/core/pwa/pwa-config';
import type { RouteCodeMode } from '../../src/app/core/pwa/pwa-config';

const ROOT = join(__dirname, '..', '..');
const ORIGIN = 'https://app.test';
const TMP = mkdtempSync(join(tmpdir(), 'arc-offline-start-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

// ---- The app: an SPA shell, a lazy app screen, a lazy admin screen, and a published page.

/** A published page (the functions write these to Hosting): it uses no build code. */
const PUBLISHED_PAGE = '<!doctype html><html><head><link rel="stylesheet" href="/_site/css/site.css?v=3"></head>'
    + '<body><h1>Privacy</h1><script src="/assets/js/arc-site.js?v=3"></script></body></html>';

/** Where people go: the start page, the member area, an app screen that shows updates itself, a published page. */
const ADDRESSES = ['/', '/user/dashboard', '/app/lock', '/pages/privacy'];

function writeBuild(name: string, hash: string): string {
    const dir = join(TMP, name);
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><base href="/">
<script type="module" crossorigin src="/assets/index-${hash}.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-${hash}.js">
<link rel="stylesheet" crossorigin href="/assets/index-${hash}.css">
</head><body><arc-root></arc-root></body></html>`);
    writeFileSync(join(dir, `assets/index-${hash}.js`), `import './vendor-${hash}.js'; // build ${name}`);
    writeFileSync(join(dir, `assets/vendor-${hash}.js`), `// vendor ${name}`);
    writeFileSync(join(dir, `assets/index-${hash}.css`), `/* ${name} */`);
    writeFileSync(join(dir, `assets/lock.page-${hash}.js`), `// app screen ${name}`);
    writeFileSync(join(dir, `assets/content.page-${hash}.js`), `// admin screen ${name}`);
    return dir;
}

/** The chunk graph the route-code plugin records from Rollup (scripts/vite-route-code.ts). */
function bundleOf(hash: string) {
    const chunk = (fileName: string, facadeModuleId: string | null, isEntry: boolean, imports: string[], dynamicImports: string[]) =>
        ({ type: 'chunk', fileName, facadeModuleId, isEntry, imports, dynamicImports });
    return {
        [`assets/index-${hash}.js`]: chunk(`assets/index-${hash}.js`, '/r/src/main.ts', true, [`assets/vendor-${hash}.js`],
            [`assets/lock.page-${hash}.js`, `assets/content.page-${hash}.js`]),
        [`assets/vendor-${hash}.js`]: chunk(`assets/vendor-${hash}.js`, null, false, [], []),
        [`assets/lock.page-${hash}.js`]: chunk(`assets/lock.page-${hash}.js`, '/r/src/custom/pages/app/lock.page.ts', false, [], []),
        [`assets/content.page-${hash}.js`]: chunk(`assets/content.page-${hash}.js`, '/r/src/app/pages/admin/contents/index.page.ts', false, [], []),
    };
}

/** vite-plugin-pwa's own defaults, laid under ours as the plugin does (its resolveOptions). */
const PLUGIN_DEFAULTS = {
    offlineGoogleAnalytics: false,
    cleanupOutdatedCaches: true,
    dontCacheBustURLsMatching: /^assets\//,
    navigateFallback: 'index.html',
};

async function buildServiceWorker(dir: string, hash: string, mode: RouteCodeMode, navigationTimeoutSeconds = 4, withoutCheck = false) {
    const stored = routeCode(mode, () => undefined);
    (stored.recorder.generateBundle as unknown as (o: unknown, b: unknown) => void).call({}, {}, bundleOf(hash));
    const settings = pwaWorkbox({ transform: stored.transform, navigationTimeoutSeconds });
    const pages = settings.runtimeCaching![0].options!;
    expect(pages.plugins).toEqual([currentBuildPages]);
    // The same settings without the check: what Arc CMS shipped before.
    if (withoutCheck) pages.plugins = [];
    await generateSW({
        ...PLUGIN_DEFAULTS,
        ...settings,
        globDirectory: dir,
        swDest: join(dir, 'sw.js'),
        // Workbox's development build: the same code with its argument checks on. The
        // production build is minified by worker threads, which the suite's zone.js setup
        // breaks.
        mode: 'development',
        sourcemap: false,
    });
}

// ---- The browser's stored files (Cache Storage), kept across service worker versions.

interface Stored { url: string; status: number; headers: [string, string][]; body: ArrayBuffer }

class FakeCache {
    entries = new Map<string, Stored>();
    pending = new Set<Promise<void>>();
    async match(input: RequestInfo | URL, options: CacheQueryOptions = {}) {
        const url = absolute(input);
        const found = this.entries.get(url) ?? (options.ignoreSearch
            ? [...this.entries.values()].find((e) => e.url.split('?')[0] === url.split('?')[0])
            : undefined);
        return found ? new Response(found.body.slice(0), { status: found.status, headers: found.headers }) : undefined;
    }
    async matchAll(input?: RequestInfo | URL, options?: CacheQueryOptions) {
        const one = input ? await this.match(input, options) : undefined;
        return one ? [one] : [];
    }
    put(input: RequestInfo | URL, response: Response) {
        const url = absolute(input);
        const work = (async () => {
            const body = await response.arrayBuffer();
            this.entries.set(url, { url, status: response.status, headers: [...response.headers.entries()], body });
        })();
        this.pending.add(work);
        return work.finally(() => this.pending.delete(work));
    }
    async delete(input: RequestInfo | URL) {
        return this.entries.delete(absolute(input));
    }
    async keys() {
        return [...this.entries.keys()].map((url) => new Request(url));
    }
}

class FakeCacheStorage {
    caches = new Map<string, FakeCache>();
    async open(name: string) {
        if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
        return this.caches.get(name)!;
    }
    async has(name: string) {
        return this.caches.has(name);
    }
    async delete(name: string) {
        return this.caches.delete(name);
    }
    async keys() {
        return [...this.caches.keys()];
    }
    async match(input: RequestInfo | URL, options: CacheQueryOptions & { cacheName?: string } = {}) {
        for (const [name, cache] of this.caches) {
            if (options.cacheName && options.cacheName !== name) continue;
            const found = await cache.match(input, options);
            if (found) return found;
        }
        return undefined;
    }
    /** Waits until every store in progress is written. */
    async settle() {
        for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            const pending = [...this.caches.values()].flatMap((c) => [...c.pending]);
            if (!pending.length) return;
            await Promise.allSettled(pending);
        }
    }
    /** Every stored address, from any cache. */
    urls(cacheName: string) {
        return [...(this.caches.get(cacheName)?.entries.keys() ?? [])].map((url) => url.replace(ORIGIN, ''));
    }
}

function absolute(input: RequestInfo | URL): string {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(url, ORIGIN).href;
}

// ---- The server (Firebase Hosting: files, published pages, every other address the shell) and the network.

type Network = 'online' | 'offline' | 'no-internet';

class FakeServer {
    deployed = '';
    network: Network = 'online';
    // An async function: its promises are the engine's own, not the suite's zone.js ones,
    // which would report every refused request as unhandled.
    fetch = async (input: RequestInfo | URL): Promise<Response> => {
        if (this.network === 'offline') throw new TypeError('Failed to fetch');
        if (this.network === 'no-internet') return new Promise<never>(() => undefined); // waits for good
        const path = new URL(absolute(input)).pathname;
        if (path === '/pages/privacy') return html(PUBLISHED_PAGE);
        if (path === SHELL_URL || !path.includes('.')) return html(readFileSync(join(this.deployed, 'index.html'), 'utf8'));
        const file = join(this.deployed, path);
        return existsSync(file) ? new Response(readFileSync(file), { status: 200 }) : new Response('Not found', { status: 404 });
    };
}

const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

/** A page load: the browser's own request mode for it, which Request cannot be given. */
class NavigationRequest extends Request {
    override get mode(): RequestMode {
        return 'navigate';
    }
}

// ---- A service worker: sw.js and Workbox's code, run as the browser would.

/** The service worker's own events, which Workbox's checks ask for by class. */
class ExtendableEvent {
    waits: Promise<unknown>[] = [];
    constructor(readonly type: string) {}
    waitUntil(promise: Promise<unknown>) {
        this.waits.push(promise);
    }
}

class FetchEvent extends ExtendableEvent {
    answer: Promise<Response> | undefined;
    readonly clientId = '';
    readonly resultingClientId = 'tab';
    constructor(readonly request: Request) {
        super('fetch');
    }
    respondWith(response: Promise<Response> | Response) {
        this.answer = Promise.resolve(response);
    }
}

/** IndexedDB that never answers: the pages cache's entry limit keeps its dates there, which this check does not need. */
class IDBRequest {
    addEventListener() { /* never fires */ }
    removeEventListener() { /* nothing to remove */ }
}

async function startWorker(dir: string, caches: FakeCacheStorage, server: FakeServer) {
    const listeners = new Map<string, ((event: unknown) => void)[]>();
    const scope: Record<string, unknown> = {
        __WB_DISABLE_DEV_LOGS: true,
        location: new URL(`${ORIGIN}/sw.js`),
        registration: { scope: `${ORIGIN}/` },
        caches,
        fetch: server.fetch,
        Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
        setTimeout, clearTimeout, console, performance,
        indexedDB: { open: () => new IDBRequest() },
        IDBRequest, IDBDatabase: class {}, IDBObjectStore: class {}, IDBIndex: class {}, IDBCursor: class {}, IDBTransaction: class {},
        ExtendableEvent, FetchEvent,
        clients: { claim: async () => undefined, matchAll: async () => [] },
        skipWaiting: async () => undefined,
        addEventListener: (type: string, listener: (event: unknown) => void) => {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        importScripts: (...urls: string[]) => {
            for (const url of urls) vm.runInContext(readFileSync(join(dir, new URL(url, ORIGIN).pathname), 'utf8'), context);
        },
    };
    scope['self'] = scope;
    const context = vm.createContext(scope);
    vm.runInContext(readFileSync(join(dir, 'sw.js'), 'utf8'), context);
    // sw.js loads Workbox's code through its small module loader, which registers the
    // listeners a moment later (in the browser, before the script's evaluation ends).
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!listeners.get('fetch')?.length) throw new Error('The service worker registered no fetch listener.');

    const lifecycle = async (type: 'install' | 'activate') => {
        const event = new ExtendableEvent(type);
        for (const listener of listeners.get(type) ?? []) listener(event);
        await Promise.all(event.waits);
    };

    /** The browser asks the service worker; without an answer, the network. */
    const request = async (url: string, navigate: boolean): Promise<Response> => {
        const event = new FetchEvent(navigate ? new NavigationRequest(`${ORIGIN}${url}`) : new Request(`${ORIGIN}${url}`));
        for (const listener of listeners.get('fetch') ?? []) listener(event);
        // Stored after the answer, while the page goes on (the entry limit's dates never finish).
        for (const wait of event.waits) Promise.resolve(wait).catch(() => undefined);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const response = await Promise.race([
            event.answer ?? server.fetch(event.request),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer for ${url} within 10 seconds`)), 10_000); }),
        ]).finally(() => clearTimeout(timer));
        await caches.settle();
        return response;
    };

    return { lifecycle, request };
}

type Worker = Awaited<ReturnType<typeof startWorker>>;

/** The build code files a page starts with (its entry script, what that preloads, its styles). */
function startFiles(page: string): string[] {
    return Array.from(page.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)=["']?([^"'\s>]+)/gi), (m) => m[1])
        .filter((url) => /^\/assets\/[^?#]*-[\w-]{8}\.(?:js|css)$/.test(url));
}

/** Opens an address the way a cold start does: the page, then every code file it starts with. */
async function coldStart(worker: Worker, address: string) {
    const page = await (await worker.request(address, true)).text();
    const missing: string[] = [];
    for (const file of startFiles(page)) {
        const ok = await worker.request(file, false).then((r) => r.ok, () => false);
        if (!ok) missing.push(file);
    }
    return { page, files: startFiles(page), missing };
}

/** Deploy 1, people open each address, deploy 2, the update is applied: the stored files as they then are. */
async function afterAnUpdate(mode: RouteCodeMode, options: { timeout?: number; plain?: boolean } = {}) {
    const name = `${mode}${options.timeout ?? ''}${options.plain ? '-plain' : ''}`;
    const one = writeBuild(`${name}-1`, 'AAAAAAAA');
    const two = writeBuild(`${name}-2`, 'BBBBBBBB');
    await buildServiceWorker(one, 'AAAAAAAA', mode, options.timeout, options.plain);
    await buildServiceWorker(two, 'BBBBBBBB', mode, options.timeout, options.plain);
    const caches = new FakeCacheStorage();
    const server = new FakeServer();

    server.deployed = one;
    const first = await startWorker(one, caches, server);
    await first.lifecycle('install');
    await first.lifecycle('activate');
    for (const address of ADDRESSES) await coldStart(first, address);
    await first.request('/assets/lock.page-AAAAAAAA.js', false); // the app screen opened

    server.deployed = two;
    const second = await startWorker(two, caches, server);
    await second.lifecycle('install');
    await second.lifecycle('activate'); // the update applied, or every tab closed
    return { worker: second, caches, server };
}

describe('offline start after an update (F7)', () => {
    it('the settings checked here are the ones the build uses', () => {
        const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
        expect(vite).toMatch(/workbox: pwaWorkbox\(\{[\s\S]*navigationTimeoutSeconds: pwa\.navigationTimeoutSeconds/);
        // vite-plugin-pwa lays these under the settings (its resolveOptions), as PLUGIN_DEFAULTS does.
        const plugin = readFileSync(join(ROOT, 'node_modules/vite-plugin-pwa/dist/index.js'), 'utf8');
        expect(plugin).toMatch(/offlineGoogleAnalytics: false,\s*cleanupOutdatedCaches: true,\s*dontCacheBustURLsMatching,\s*mode,\s*navigateFallback: "index.html"/);
    });

    it('without the check, a stored page of the old version opens offline and cannot start: the blank screen', async () => {
        const { worker, caches, server } = await afterAnUpdate('app', { plain: true });
        expect(caches.urls('arc-pages')).toEqual(expect.arrayContaining(ADDRESSES));
        server.network = 'offline';
        const start = await coldStart(worker, '/user/dashboard');
        expect(start.files).toContain('/assets/index-AAAAAAAA.js');
        expect(start.missing).toContain('/assets/index-AAAAAAAA.js');
    }, 120_000);

    for (const mode of ['app', 'visited'] as const) {
        it(`routeCode '${mode}': every stored address starts offline after an update, on this version's code`, async () => {
            const { worker, caches, server } = await afterAnUpdate(mode);
            // The pages of deploy 1 are still stored: the check is what keeps them from opening.
            expect(caches.urls('arc-pages')).toEqual(expect.arrayContaining(ADDRESSES));
            server.network = 'offline';
            for (const address of ADDRESSES) {
                const start = await coldStart(worker, address);
                expect(start.missing, address).toEqual([]);
                expect(start.page, address).not.toContain('AAAAAAAA');
                if (address === '/pages/privacy') expect(start.page).toBe(PUBLISHED_PAGE); // its stored copy, as before
                else expect(start.files, address).toContain('/assets/index-BBBBBBBB.js');
            }
            // The app screen's own code: stored ahead with 'app'. With 'visited' it was never
            // loaded in this version, so the router's import fails and StaleCodeService takes
            // over (stale() on a pwaUpdate: 'app' page, src/app/core/version/stale-code.service.spec.ts).
            const screen = await worker.request('/assets/lock.page-BBBBBBBB.js', false).then((r) => r.ok, () => false);
            expect(screen).toBe(mode === 'app');
        }, 120_000);
    }

    it('a stored page of this version still opens offline (nothing changes before an update)', async () => {
        const { worker, caches, server } = await afterAnUpdate('app');
        await coldStart(worker, '/user/dashboard'); // online: stored again, from deploy 2
        const stored = await caches.match(`${ORIGIN}/user/dashboard`);
        expect(await stored!.text()).toContain('BBBBBBBB');
        server.network = 'offline';
        expect((await coldStart(worker, '/user/dashboard')).missing).toEqual([]);
    }, 120_000);

    it('with the network up and no internet, a page opens after navigationTimeoutSeconds, not the default 4', async () => {
        const { worker, server } = await afterAnUpdate('app', { timeout: 1 });
        server.network = 'no-internet';
        const started = Date.now();
        const start = await coldStart(worker, '/app/lock');
        const waited = Date.now() - started;
        expect(waited).toBeGreaterThanOrEqual(900);
        expect(waited).toBeLessThan(4000); // the default would wait at least 4 seconds
        expect(start.missing).toEqual([]);
        expect(start.files).toContain('/assets/index-BBBBBBBB.js');
    }, 120_000);

    it('writes the timeout into the service worker: 4 seconds unless the app sets it', async () => {
        const dir = writeBuild('timeout-default', 'CCCCCCCC');
        await buildServiceWorker(dir, 'CCCCCCCC', 'visited', resolvePwaConfig({}, true).navigationTimeoutSeconds);
        expect(readFileSync(join(dir, 'sw.js'), 'utf8')).toMatch(/"?cacheName"?:\s*"arc-pages",\s*"?networkTimeoutSeconds"?:\s*4\b/);
        await buildServiceWorker(dir, 'CCCCCCCC', 'visited', resolvePwaConfig({ navigationTimeoutSeconds: 2 }, true).navigationTimeoutSeconds);
        expect(readFileSync(join(dir, 'sw.js'), 'utf8')).toMatch(/"?cacheName"?:\s*"arc-pages",\s*"?networkTimeoutSeconds"?:\s*2\b/);
    }, 120_000);
});
