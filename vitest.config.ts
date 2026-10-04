/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { resolve } from 'node:path';
import { arcSite } from './scripts/vite-arc-site';

export default defineConfig({
    // arcSite: the `virtual:arc-site` module (header, footer, manifest) the app imports.
    plugins: [angular(), arcSite({ assemble: false })],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts', 'functions/src/__tests__/setup.ts'],
        // Writes the functions' generated feature files before any spec loads them.
        globalSetup: ['./scripts/vitest-global-setup.ts'],
        include: ['src/**/*.spec.ts', 'functions/src/**/*.spec.ts', 'scripts/**/*.spec.ts', 'custom/**/*.spec.ts'],
        reporters: ['default'],
        server: {
            deps: {
                inline: [
                    'rxfire',
                    '@angular/fire',
                    'firebase',
                ],
            },
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.spec.ts',
                'src/test/**',
                'src/main.ts',
                'src/main.server.ts',
                'src/vite-env.d.ts',
            ],
        },
    },
    resolve: {
        alias: {
            'src': resolve(__dirname, './src'),
            // Provided by the PWA build plugin (vite.config.ts), which tests do not load.
            'virtual:pwa-register': resolve(__dirname, './src/test/pwa-register.stub.ts'),
        },
    },
});

