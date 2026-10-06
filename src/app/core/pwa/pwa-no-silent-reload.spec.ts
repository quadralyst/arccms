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

    describe('third-party code: the PWA library\'s own reload (another tab applied an update)', () => {
        const library = join(ROOT, 'node_modules/vite-plugin-pwa/dist');

        it('the build bundles the registration code checked here, and only Arc CMS registers', () => {
            // The plugin reads client/<build|dev>/register.js and fills in its placeholders.
            expect(readFileSync(join(library, 'index.js'), 'utf8')).toContain('client/${mode}/${source}.js');
            const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
            // No registration script of the plugin's own: PwaService registers.
            expect(config).toMatch(/injectRegister:\s*false/);
            const files = [...sources(join(ROOT, 'src/app')), ...sources(join(ROOT, 'src/shared'))];
            const registering = files.filter((f) => readFileSync(f, 'utf8').includes("'virtual:pwa-register'")).map((f) => relative(ROOT, f));
            expect(registering).toEqual(['src/app/core/pwa/pwa.service.ts']);
        });

        it('every reload in the library\'s registration code is only a fallback for a missing onNeedReload', () => {
            const code = readFileSync(join(library, 'client/build/register.js'), 'utf8');
            const reloads = code.match(/location\.reload\s*\(/g) ?? [];
            const fallbacks = code.match(/if\s*\(onNeedReload\)\s*onNeedReload\(\);?\s*else\s*window\.location\.reload\(\)/g) ?? [];
            expect(reloads.length).toBeGreaterThan(0);
            // A library upgrade that reloads some other way fails here: look at it again.
            expect(fallbacks.length).toBe(reloads.length);
            for (const word of ['location.assign', 'location.replace', 'location.href', 'navigate(']) expect(code, word).not.toContain(word);
        });

        it('PwaService always gives the library its own onNeedReload, which checks the page before any reload', () => {
            const service = readFileSync(join(ROOT, 'src/app/core/pwa/pwa.service.ts'), 'utf8');
            const registration = service.slice(service.indexOf('registerSW({'), service.indexOf('});', service.indexOf('registerSW({')));
            expect(registration).toMatch(/onNeedReload:\s*\(\)\s*=>\s*this\.onNewVersionInControl\(\)/);
            const handler = service.slice(service.indexOf('private onNewVersionInControl'));
            expect(handler.indexOf('routeOwnsPwaUpdate')).toBeGreaterThan(-1);
            expect(handler.indexOf('routeOwnsPwaUpdate')).toBeLessThan(handler.indexOf('PWA_RELOAD'));
            // The page reloads only there and in applyUpdate(), which the app or the bar calls.
            const reloads = service.match(/get\(PWA_RELOAD\)\(\)/g) ?? [];
            expect(reloads.length).toBe(2);
            // and nowhere by hand: the one location.reload() is the token's own.
            expect(service.match(/location\.(reload|assign|replace)\b/g)).toEqual(['location.reload']);
            expect(service).toMatch(/factory:\s*\(\)\s*=>\s*\(\)\s*=>\s*location\.reload\(\)/);
        });
    });
});
