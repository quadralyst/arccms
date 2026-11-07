/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { resolve } from 'node:path';
import { arcSite } from './scripts/vite-arc-site';
// @ts-expect-error: plain ESM script without type declarations
import { onlyServerSpecs } from './scripts/vitest-only-server.mjs';

const shared = {
    resolve: {
        alias: {
            'src': resolve(__dirname, './src'),
            // Provided by the PWA build plugin (vite.config.ts), which tests do not load.
            'virtual:pwa-register': resolve(__dirname, './src/test/pwa-register.stub.ts'),
        },
    },
    // No browser here: Vite's scan of every .html file, docs/ included, only costs time.
    optimizeDeps: { noDiscovery: true, include: [] },
};

// Specs with no Angular: no compiler to start, so one spec runs in seconds.
const server = {
    ...shared,
    test: {
        name: 'server',
        globals: true,
        environment: 'node',
        pool: 'forks',
        setupFiles: ['functions/src/__tests__/setup.ts'],
        include: ['functions/src/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    },
} as const;

const app = {
    ...shared,
    // arcSite: the `virtual:arc-site` module (header, footer, manifest) the app imports.
    plugins: [angular(), arcSite({ assemble: false })],
    test: {
        name: 'app',
        globals: true,
        environment: 'jsdom',
        // Named here because the Angular plugin picks vmThreads when none is named,
        // and that pool has no useful memory cap by default: a run reached 21 GB.
        // A worker past the limit is replaced, which brought a whole run from 21 GB to 15 GB.
        pool: 'vmThreads',
        vmMemoryLimit: '1500MB',
        setupFiles: ['./src/test/setup.ts', 'functions/src/__tests__/setup.ts'],
        include: ['src/**/*.spec.ts', 'custom/**/*.spec.ts'],
        server: {
            deps: {
                inline: [
                    'rxfire',
                    '@angular/fire',
                    'firebase',
                ],
            },
        },
    },
} as const;

export default defineConfig({
    test: {
        // Half the cores: more workers gained about 9% and left the machine unusable.
        maxWorkers: '50%',
        // Writes the functions' generated feature files before any spec loads them.
        globalSetup: ['./scripts/vitest-global-setup.ts'],
        reporters: ['default'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.spec.ts',
                'src/test/**',
                'src/main.ts',
                'src/vite-env.d.ts',
            ],
        },
        projects: onlyServerSpecs(process.argv) ? [server] : [server, app],
    },
});
