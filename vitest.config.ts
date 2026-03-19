/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { resolve } from 'node:path';

export default defineConfig({
    plugins: [angular()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts', 'functions/src/__tests__/setup.ts'],
        include: ['src/**/*.spec.ts', 'functions/src/**/*.spec.ts'],
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
        },
    },
});

