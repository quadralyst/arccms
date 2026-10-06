/**
 * The service worker's settings (docs/features/pwa.html): what it stores and how it answers.
 * vite.config.ts hands them to the PWA plugin, and scripts/__tests__/pwa-offline-start.spec.ts
 * builds a real service worker from them to check an offline start after an update
 * (specs/app-pwa-offline-start-spec.md).
 */
import type { GenerateSWOptions, ManifestTransform } from 'workbox-build';
import type { WorkboxPlugin } from 'workbox-core/types';
import type { routeCode } from './vite-route-code';

/** The SPA shell (copied to __shell.html after the build): what opens offline. */
export const SHELL_URL = '/__shell.html';

/**
 * A page stored in `arc-pages` opens only while the code files it starts with are still on
 * the device. After an update the old version's code is gone, so its stored pages would
 * open blank: the current version's app shell opens instead, at the same address.
 *
 * workbox-build copies this function's source into sw.js, so it names nothing from outside
 * itself, not even SHELL_URL.
 */
export const currentBuildPages: WorkboxPlugin = {
    cachedResponseWillBeUsed: async ({ cachedResponse }) => {
        if (!cachedResponse) return null;
        const html = await cachedResponse.clone().text();
        const code = Array.from(html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)=["']?([^"'\s>]+)/gi), (m) => m[1])
            .filter((url) => /^\/assets\/[^?#]*-[\w-]{8}\.(?:js|css)$/.test(url));
        const stored = await Promise.all(code.map((url) => caches.match(url, { ignoreSearch: true })));
        if (stored.every(Boolean)) return cachedResponse;
        const precache = (await caches.keys()).find((name) => name.startsWith('workbox-precache-'));
        const shell = precache ? await (await caches.open(precache)).match('/__shell.html', { ignoreSearch: true }) : undefined;
        return shell ?? null;
    },
};

export interface PwaWorkboxOptions {
    /**
     * Chooses the code files stored up front from the build's chunk graph
     * (scripts/vite-route-code.ts, by routeCode). Without it, only the main bundle.
     */
    transform?: ReturnType<typeof routeCode>['transform'];
    /** How long a page waits for the network before the stored copy opens (PwaConfig). */
    navigationTimeoutSeconds: number;
}

type WorkboxSettings = Omit<GenerateSWOptions, 'globDirectory' | 'swDest'>;

export function pwaWorkbox({ transform, navigationTimeoutSeconds }: PwaWorkboxOptions): WorkboxSettings {
    return {
        // Up front, only the files every page starts with (routeCode 'visited'); the
        // rest is stored the first time it loads (below), which spares mobile data.
        // With routeCode 'app' or 'all', also the code of those screens. Chosen from
        // the build's own chunk graph by the transform.
        globPatterns: transform ? ['**/*.{css,woff2}', 'assets/**/*.js'] : ['**/*.{css,woff2}', 'assets/index-*.js'],
        ...(transform ? { manifestTransforms: [transform as unknown as ManifestTransform] } : {}),
        globIgnores: ['**/*.map'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Versioned by index.html (the same file), which names every hashed
        // code file: a build that changes nothing leaves the service worker
        // as it is, so people are asked to update only when something changed.
        templatedURLs: { [SHELL_URL]: ['index.html'] },
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
            {
                // Pages: always the network first, so published content is never
                // stale; offline (or after the wait), the last copy if this version
                // can open it, else the shell.
                urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/__/'),
                handler: 'NetworkFirst',
                options: {
                    cacheName: 'arc-pages',
                    networkTimeoutSeconds: navigationTimeoutSeconds,
                    expiration: { maxEntries: 50 },
                    plugins: [currentBuildPages],
                    precacheFallback: { fallbackURL: SHELL_URL },
                },
            },
            {
                // Built code and styles: the name carries a hash of the content
                // (index-C0k4xnXa.js), so a stored copy is always right.
                urlPattern: ({ url, sameOrigin }) => sameOrigin && /-[\w-]{8}\.(?:js|css|woff2?)$/.test(url.pathname),
                handler: 'CacheFirst',
                options: { cacheName: 'arc-code', expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 } },
            },
            {
                // Files from public/ keep their name across builds: use the stored
                // copy, and fetch the new one for next time.
                urlPattern: ({ url, sameOrigin }) => sameOrigin && /\.(?:js|css|woff2?)$/.test(url.pathname),
                handler: 'StaleWhileRevalidate',
                options: { cacheName: 'arc-files', expiration: { maxEntries: 60 } },
            },
            {
                // Images, but never a person's own files (`users/...` in Storage: a
                // feedback screenshot, a private upload), which would stay on a shared
                // device after sign-out; and only real answers (200), since an opaque
                // cross-site answer takes megabytes of the device's quota (review F).
                urlPattern: ({ request, url }) => request.destination === 'image'
                    && !(url.hostname === 'firebasestorage.googleapis.com'
                        && /\/o\/([^/]+\/)?users\//.test(decodeURIComponent(url.pathname))),
                handler: 'StaleWhileRevalidate',
                options: {
                    cacheName: 'arc-images',
                    cacheableResponse: { statuses: [200] },
                    expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
                },
            },
            {
                urlPattern: ({ url }) => /^(fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)$/.test(url.hostname),
                handler: 'CacheFirst',
                options: { cacheName: 'arc-cdn', expiration: { maxEntries: 60, maxAgeSeconds: 365 * 24 * 60 * 60 } },
            },
        ],
    };
}
