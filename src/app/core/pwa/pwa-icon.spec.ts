/**
 * The image the PWA's icons are made from (docs/features/pwa.html): the file `icon` in
 * src/custom/pwa.ts names, so a white-label app can give each brand its own, else the
 * app's src/custom/pwa-icon.svg or .png, else Arc CMS's own.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_PWA_ICON, resolvePwaIcon } from './pwa-config';

const files = (...paths: string[]) => (path: string) => paths.includes(path);

describe('the PWA icon', () => {
    it('is the file pwa.ts names, wherever it is in the project', () => {
        expect(resolvePwaIcon({ icon: 'src/custom/brands/acme/icon.svg' }, files('src/custom/brands/acme/icon.svg', 'src/custom/pwa-icon.svg'))).toBe('src/custom/brands/acme/icon.svg');
        expect(resolvePwaIcon({ icon: './src/custom/brands/beta/icon.PNG' }, files('src/custom/brands/beta/icon.PNG'))).toBe('src/custom/brands/beta/icon.PNG');
    });

    it('is src/custom/pwa-icon.svg, then .png, when pwa.ts names none, else Arc CMS\'s own', () => {
        expect(resolvePwaIcon({}, files('src/custom/pwa-icon.svg', 'src/custom/pwa-icon.png'))).toBe('src/custom/pwa-icon.svg');
        expect(resolvePwaIcon(undefined, files('src/custom/pwa-icon.png'))).toBe('src/custom/pwa-icon.png');
        expect(resolvePwaIcon({}, files())).toBe(DEFAULT_PWA_ICON);
    });

    it('stops the build on a named file that is missing or is not an .svg or .png', () => {
        expect(() => resolvePwaIcon({ icon: 'src/custom/brands/gone.svg' }, files())).toThrow("src/custom/pwa.ts: icon names src/custom/brands/gone.svg, which is not there");
        expect(() => resolvePwaIcon({ icon: 'src/custom/icon.jpg' }, files('src/custom/icon.jpg'))).toThrow('icon must name an .svg or .png file');
        expect(() => resolvePwaIcon({ icon: 42 as never }, files())).toThrow('icon must name an .svg or .png file');
    });

    it('is what the build makes every icon size from', () => {
        const vite = readFileSync(resolve(__dirname, '../../../../vite.config.ts'), 'utf8');
        expect(vite).toContain('const pwaIcon = resolvePwaIcon(CUSTOM_PWA, (path) => existsSync(resolve(path)));');
        expect(vite).toContain('image: pwaIcon,');
    });
});
