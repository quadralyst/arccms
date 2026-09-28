/// <reference types="vitest" />

import { defineConfig, type Plugin } from 'vite';
import analog from '@analogjs/platform';
import { dirname, resolve } from 'path';
import { existsSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';
import { minimal2023Preset } from '@vite-pwa/assets-generator/config';
import { DEFAULT_PWA_ICON, PWA_ICON_CANDIDATES, resolvePwaConfig } from './src/app/core/pwa/pwa-config';
import { CUSTOM_PWA } from './src/custom/pwa';

// The install's PWA settings (src/custom/pwa.ts over the core defaults, docs/pwa.md).
const pwa = resolvePwaConfig(CUSTOM_PWA);
const pwaIcon = PWA_ICON_CANDIDATES.find((path) => existsSync(resolve(path))) ?? DEFAULT_PWA_ICON;

/**
 * Limit plugins to the browser (client) build. Analog builds the browser and the
 * server bundles with the same plugin instances, and the PWA plugin keeps the last
 * config it is given: the server one, so it wrote no service worker. Here it never
 * sees the server config.
 */
function clientOnly(plugins: Plugin[]): Plugin[] {
  return plugins.map((plugin) => {
    const hook = plugin.configResolved;
    const handler = typeof hook === 'function' ? hook : hook?.handler;
    return {
      ...plugin,
      applyToEnvironment: (env) => env.name === 'client',
      ...(handler && {
        configResolved(config) {
          if (!config.build.ssr) return handler.call(this, config);
        },
      }),
    };
  });
}

/** The iPhone home screen icon and name (other browsers read the manifest). */
function appleLinks(): Plugin {
  return {
    name: 'arc-pwa-apple-links',
    apply: 'build',
    applyToEnvironment: (env) => env.name === 'client',
    transformIndexHtml: () =>
      pwa.enabled
        ? [
            { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon-180x180.png' }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: pwa.shortName }, injectTo: 'head' },
          ]
        : [],
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  return {
    build: {
      target: ['es2020'],
    },
    server: {
      /**
       * Honour an assigned port.
       *
       * Vite otherwise hardcodes 5173 and silently increments when that is
       * taken, which leaves a supervising process watching a port nothing is
       * listening on. Reading PORT lets a second dev server be started
       * alongside a running one. Unset falls back to Vite's own default.
       */
      port: process.env['PORT'] ? Number(process.env['PORT']) : undefined,
    },
    resolve: {
      mainFields: ['module'],
      alias: {
        ...(mode === 'production' && process.env['USE_DEV_ENV'] !== 'true'
          ? {
              [resolve('./src/environments/environment.ts')]: resolve(
                './src/environments/environment.prod.ts',
              ),
              // Keep relative match as fallback or strictly for the known import
              '../environments/environment': resolve(
                './src/environments/environment.prod.ts',
              ),
            }
          : {}),
      },
    },
    plugins: [
      // PWA (docs/pwa.md): manifest, icons and service worker, only when the install turns it on.
      // Browser build only: Analog also builds the server bundle with these plugins,
      // and the PWA plugin skips the service worker when it last saw a server build.
      appleLinks(),
      ...clientOnly(VitePWA({
        disable: !pwa.enabled,
        // Never swap versions under someone: the update bar asks first (PwaService).
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          id: '/',
          name: pwa.name,
          short_name: pwa.shortName,
          description: pwa.description,
          theme_color: pwa.themeColor,
          background_color: pwa.backgroundColor,
          display: 'standalone',
          start_url: pwa.startUrl,
          scope: '/',
        },
        // Every icon size (Android, maskable, iPhone) made from one image.
        pwaAssets: {
          disabled: !pwa.enabled,
          image: pwaIcon,
          // The home screen icons only: the install keeps its own favicon.
          preset: { ...minimal2023Preset, transparent: { ...minimal2023Preset.transparent, favicons: [] } },
          overrideManifestIcons: true,
          // Its head links name the source image, which is not published; appleLinks() adds the one needed.
          includeHtmlHeadLinks: false,
          injectThemeColor: true,
          // The icon lives outside public/; write the generated icons to the site root.
          integration: { publicDir: resolve(dirname(pwaIcon)), outDir: resolve('dist/client') },
        },
        workbox: {
          // Up front, only the files every page needs; the rest is stored the
          // first time it loads (below), which spares mobile data.
          globPatterns: ['**/*.{css,woff2}', 'assets/index-*.js'],
          globIgnores: ['**/*.map'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // The SPA shell (copied to __shell.html after the build): what opens offline.
          // Versioned by index.html (the same file), which names every hashed
          // code file: a build that changes nothing leaves the service worker
          // as it is, so people are asked to update only when something changed.
          templatedURLs: { '/__shell.html': ['index.html'] },
          navigateFallback: null,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // Pages: always the network first, so published content is never
              // stale; offline, the last copy, else the shell.
              urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/__/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'arc-pages',
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 50 },
                precacheFallback: { fallbackURL: '/__shell.html' },
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
        },
      })),
      analog({
        // The app's own file-based pages (docs/custom-code.md), next to src/app/pages.
        additionalPagesDirs: ['/src/custom/pages'],
        // ssr: true enables build-time prerendering (SSG) — no runtime server is deployed.
        // The server bundle is built but never referenced in firebase.json.
        ssr: true,
        prerender: {
          // '/' is prerendered for SEO (social crawlers, fast FCP for the home page).
          // The SPA fallback for all other routes is __shell.html, copied from
          // dist/client/index.html by the post-build step (see package.json "build" script).
          // Firebase hosting serves __shell.html for non-file routes (see firebase.json rewrites).
          // '/' plus every translated home page that exists as a file under
          // public/i18n/{lang}/index.html. Hand-maintained: the language list
          // is runtime data in Firestore, but prerendering is a build-time
          // decision and only a real file can be prerendered.
          routes: ['/', '/hi'],
        },
        nitro: {
          preset: 'firebase',
          firebase: {
            gen: 2,
            nodeVersion: '22',
            serverFunctionName: 'server',
          },
          externals: {
            inline: [],
            external: ['firebase-admin/app', 'firebase-admin/firestore'],
          },
        },
      }),
    ],
  };
});
