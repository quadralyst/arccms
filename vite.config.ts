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
          routes: ['/'],
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
