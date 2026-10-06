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

    it('applies an update only from the update bar: no other core file calls applyUpdate() or the update() alias', () => {
        const files = [...sources(join(ROOT, 'src/app')), ...sources(join(ROOT, 'src/shared'))];
        const callers = files
            .filter((file) => {
                const text = readFileSync(file, 'utf8');
                // applyUpdate is a name only the PWA service has, so any receiver counts.
                if (/\.applyUpdate\s*\(/.test(text)) return true;
                // update() is a common name: count it only in files that use the PWA service.
                return /\bPwaService\b/.test(text) && /\.update\s*\(\s*\)/.test(text);
            })
            .map((file) => relative(ROOT, file))
            .filter((file) => file !== 'src/app/core/pwa/pwa.service.ts');
        expect(callers).toEqual(['src/shared/components/install-prompt/update-bar.component.ts']);
    });

    it('loads a page by itself only to recover a missing screen, and never on a page that owns its updates (A8)', () => {
        const files = [...sources(join(ROOT, 'src/app')), ...sources(join(ROOT, 'src/shared'))];
        const recover = readFileSync(join(ROOT, 'src/app/core/version/stale-code.service.ts'), 'utf8');
        const body = recover.slice(recover.indexOf('private onNavigationError'));
        expect(body.indexOf('routeOwnsPwaUpdate')).toBeGreaterThan(-1);
        expect(body.indexOf('routeOwnsPwaUpdate')).toBeLessThan(body.indexOf('this.page.assign'));
        // No other core file reloads a page by itself on a router error.
        const others = files.filter((f) => !f.endsWith('stale-code.service.ts') && /NavigationError[\s\S]*location\.(assign|reload)/.test(readFileSync(f, 'utf8')));
        expect(others).toEqual([]);
    });
});
