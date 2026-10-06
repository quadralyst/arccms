/// <reference types="vitest" />

import { defineConfig, type Plugin } from 'vite';
import analog from '@analogjs/platform';
import { dirname, resolve } from 'path';
import { existsSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';
import { minimal2023Preset } from '@vite-pwa/assets-generator/config';
import { DEFAULT_PWA_ICON, PWA_ICON_CANDIDATES, resolvePwaConfig } from './src/app/core/pwa/pwa-config';
import { CUSTOM_PWA } from './src/custom/pwa';
import { resolveFeatures } from './src/app/core/features/feature-registry';
import { CUSTOM_FEATURES } from './src/custom/features';
import { oneBuildAtATime } from './scripts/vite-build-order';
import { arcSite } from './scripts/vite-arc-site';
import { environmentFor, environmentSwap } from './scripts/arc-environment.mjs';
import { routeCode } from './scripts/vite-route-code';
import { pwaWorkbox } from './scripts/pwa-workbox';

// The app's features (src/custom/features.ts, specs/feature-flags-spec.md). Resolved
// here so a typo or a missing need stops `npm run dev` and `npm run build` at once.
const features = resolveFeatures(CUSTOM_FEATURES);

// The install's PWA settings (src/custom/pwa.ts over the core defaults, docs/features/pwa.html),
// on when the features ask for it.
const pwa = resolvePwaConfig(CUSTOM_PWA, features.has('pwa'));
const pwaIcon = PWA_ICON_CANDIDATES.find((path) => existsSync(resolve(path))) ?? DEFAULT_PWA_ICON;
// Which code files the service worker stores up front (src/custom/pwa.ts routeCode,
// specs/app-route-code-spec.md): with 'visited', the default, what every page starts with.
const storedCode = routeCode(pwa.routeCode);

// The Firebase project this build talks to (specs/app-project-settings-spec.md): with
// ARC_PROJECT=<alias or id>, that project's web settings; without it, the environment
// files as always (environment.prod.ts in a production build unless USE_DEV_ENV=true).
// npm run deploy sets it to the project it deploys to.
const arcProject = process.env['ARC_PROJECT'];
const projectEnvironment = arcProject ? environmentFor(arcProject) : null;
if (projectEnvironment) {
  console.log(`Firebase project: ${projectEnvironment.projectId} (${projectEnvironment.source}, ${projectEnvironment.file.split('/src/')[1] ?? projectEnvironment.file})`);
}
const environmentFile = projectEnvironment?.file ?? null;

// Nitro's own, set before Nitro does it from inside the dev server (releaseClosedServer).
(globalThis as { defineNitroConfig?: (config: unknown) => unknown }).defineNitroConfig ??= (config) => config;

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

/**
 * Let go of a dev server when Vite closes it. Every change to this file or to
 * anything it imports (such as src/custom/features.ts) restarts the dev server,
 * and upstream bugs kept each old one in memory, Angular compiler and all
 * (about 500 MB), until `npm run dev` ran out of memory after a few restarts:
 * - Analog starts a Nitro (the API server: a file watcher and a worker thread) in
 *   `configureServer` and never closes it. The hook hands over each Nitro as it is
 *   built, and it is closed with the server that started it.
 * - Vite gives the new server the old server's environments and keeps them for
 *   good, and through their plugins every server before. The list is emptied.
 * - exsolve (Nitro's module resolver) keeps failed lookups as errors in a global
 *   cache, and an error's stack holds the functions of the server that made it.
 *   Those are dropped; a later lookup just tries again.
 * - Nitro sets a global `defineNitroConfig` once, from inside the first server's
 *   setup, which it then holds. It is set first, at the top of this file.
 */
function releaseClosedServer() {
  let nitro: { close(): Promise<void> } | undefined;
  const plugin: Plugin = {
    name: 'arc-release-closed-server',
    apply: 'serve',
    configureServer(server) {
      const environments: Record<string, unknown> = server.environments;
      server.httpServer?.once('close', () => {
        nitro?.close().catch((error) => server.config.logger.error(`Closing the API server failed: ${error}`));
        nitro = undefined;
        for (const name of Object.keys(environments)) delete environments[name];
        const resolved = (globalThis as { __EXSOLVE_CACHE__?: Map<string, unknown> }).__EXSOLVE_CACHE__;
        resolved?.forEach((value, key) => value instanceof Error && resolved.delete(key));
      });
    },
  };
  return {
    plugin,
    nitroHooks: {
      'build:before': (built: { close(): Promise<void> }) => {
        nitro = built;
      },
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const release = releaseClosedServer();
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
    },
    plugins: [
      // The environment file every import of src/environments/environment.ts gets: the
      // project's (ARC_PROJECT), else environment.prod.ts in a production build unless
      // USE_DEV_ENV=true, else environment.ts as written (scripts/arc-environment.mjs).
      environmentSwap(
        environmentFile
          ?? (mode === 'production' && process.env['USE_DEV_ENV'] !== 'true' ? resolve('./src/environments/environment.prod.ts') : null),
      ),
      // Frees a closed dev server (see releaseClosedServer).
      release.plugin,
      // The public website: core's public/ with the app's src/custom/site/ laid over it,
      // served from .arc-build/public, and the header, footer and manifest for the app
      // (scripts/arc-site.mjs, docs/website/overview.html).
      arcSite(),
      // PWA (docs/features/pwa.html): manifest, icons and service worker, only when the install turns it on.
      // Browser build only: Analog also builds the server bundle with these plugins,
      // and the PWA plugin skips the service worker when it last saw a server build.
      appleLinks(),
      ...(pwa.enabled ? [storedCode.recorder] : []),
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
        // What the service worker stores and how it answers (scripts/pwa-workbox.ts).
        workbox: pwaWorkbox({
          transform: storedCode.transform,
          navigationTimeoutSeconds: pwa.navigationTimeoutSeconds,
        }),
      })),
      // Only the browser bundle is built (ssr is off below). If server rendering is
      // ever turned back on, the browser and server bundles are built one after the
      // other, not at once, which needs less memory (scripts/vite-build-order.ts).
      ...oneBuildAtATime(analog({
        // The app's own file-based pages (docs/app/custom-space.html), next to src/app/pages.
        additionalPagesDirs: ['/src/custom/pages'],
        // No server rendering and nothing prerendered: the home page is published by
        // the functions as static /index.html and /{lang}/index.html
        // (specs/own-website-spec.md, W4), and every other route is the SPA
        // fallback, __shell.html, copied from dist/client/index.html by the
        // post-build step (package.json "build"; firebase.json rewrites serve it).
        // One browser bundle makes the build faster and lighter.
        ssr: false,
        // No Cloud Functions server bundle, which firebase.json never deploys.
        static: true,
        prerender: {
          routes: [],
        },
        nitro: {
          hooks: release.nitroHooks,
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
      })),
    ],
  };
});
