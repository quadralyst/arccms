/// <reference types="vitest" />

import { defineConfig } from 'vite';
import analog from '@analogjs/platform';
import { resolve } from 'path';

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
      analog({
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
