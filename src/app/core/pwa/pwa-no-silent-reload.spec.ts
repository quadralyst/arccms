/**
 * Arc never reloads a page for a new version by itself (docs/app/pwa.html): a person, or
 * the app, chooses when. This keeps it so.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
    });
}

describe('no silent reloads', () => {
    it('asks first: the service worker waits for the person (prompt mode, no skipWaiting)', () => {
        const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
        expect(config).toMatch(/registerType:\s*'prompt'/);
        for (const word of ['skipWaiting', 'clientsClaim', 'autoUpdate']) expect(config, word).not.toContain(word);
    });

    it('calls applyUpdate or update() on the PWA service only from the update bar and the service itself', () => {
        const callers = [...sources(join(ROOT, 'src/app')), ...sources(join(ROOT, 'src/shared'))]
            .filter((file) => /\b(pwa|pwaService)\.(applyUpdate|update)\(/.test(readFileSync(file, 'utf8')))
            .map((file) => relative(ROOT, file));
        expect(callers).toEqual(['src/shared/components/install-prompt/update-bar.component.ts']);
    });
});
