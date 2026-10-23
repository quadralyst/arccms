/**
 * The browser tab's icon (F29, scripts/vite-tab-icon.ts): made from the app's icon when
 * it has one, Arc CMS's /favicon.ico exactly as before when it has none.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { APP_FAVICON, TAB_ICON_FILES, makeTabIcon, tabIcon, withTabIcon } from '../vite-tab-icon';
import { assembleSite, CORE_PUBLIC } from '../arc-site.mjs';
import { DEFAULT_PWA_ICON } from '../../src/app/core/pwa/pwa-config';

const repo = resolve(__dirname, '../..');
const indexHtml = readFileSync(resolve(repo, 'index.html'), 'utf8');
const ARC_ICON = '<link rel="icon" type="image/x-icon" href="/favicon.ico" />';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0d8478"/></svg>';

let root: string;

function put(path: string, content: string | Buffer): void {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
}

/** The links index.html ends up with, as the Vite plugin writes them. */
function transformed(plugin: ReturnType<typeof tabIcon>): string {
    const hook = plugin.transformIndexHtml as { handler: (html: string) => string };
    return hook.handler(indexHtml);
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'arc-tab-icon-'));
    put(`${CORE_PUBLIC}/favicon.ico`, 'arc-cms-icon');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('an app with an SVG icon', () => {
    it('gets a 48px favicon.ico, a 32px PNG and the SVG itself', async () => {
        put('src/custom/pwa-icon.svg', SVG);
        const tab = await makeTabIcon('src/custom/pwa-icon.svg', root);

        expect([...tab!.files.keys()]).toEqual([TAB_ICON_FILES.ico, TAB_ICON_FILES.png, TAB_ICON_FILES.svg]);
        const ico = tab!.files.get(TAB_ICON_FILES.ico)!;
        expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]); // an ICO file
        expect(ico[6]).toBe(48);
        const png = tab!.files.get(TAB_ICON_FILES.png)!;
        expect(png.subarray(1, 4).toString()).toBe('PNG');
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([32, 32]); // the header's width and height
        expect(tab!.files.get(TAB_ICON_FILES.svg)!.toString()).toBe(SVG);
    });

    it('links no Arc CMS icon: index.html names only the made files, versioned', async () => {
        put('src/custom/pwa-icon.svg', SVG);
        const tab = await makeTabIcon('src/custom/pwa-icon.svg', root);
        const html = transformed(tabIcon(tab, 'src/custom/pwa-icon.svg'));

        expect(html).not.toContain(ARC_ICON);
        const links = [...html.matchAll(/<link rel="icon"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
        expect(links).toEqual([
            `/favicon.ico?v=${tab!.version}`,
            `/favicon-32x32.png?v=${tab!.version}`,
            `/favicon.svg?v=${tab!.version}`,
        ]);
        expect(html).toContain('type="image/svg+xml"');
    });

    it('serves the made favicon.ico in place of Arc CMS\'s, for old browsers and pages that link none', async () => {
        put('src/custom/pwa-icon.svg', SVG);
        const tab = await makeTabIcon('src/custom/pwa-icon.svg', root);
        const { dir } = assembleSite(root, undefined, { extra: tab!.files });

        expect(readFileSync(join(dir, 'favicon.ico')).equals(tab!.files.get(TAB_ICON_FILES.ico)!)).toBe(true);
        expect(readFileSync(join(dir, 'favicon-32x32.png')).equals(tab!.files.get(TAB_ICON_FILES.png)!)).toBe(true);
        expect(readFileSync(join(dir, 'favicon.svg'), 'utf8')).toBe(SVG);
    });

    it('gives the links a new version when the icon changes', async () => {
        put('src/custom/pwa-icon.svg', SVG);
        const before = (await makeTabIcon('src/custom/pwa-icon.svg', root))!.version;
        put('src/custom/pwa-icon.svg', SVG.replace('#0d8478', '#e8590c'));
        expect((await makeTabIcon('src/custom/pwa-icon.svg', root))!.version).not.toBe(before);
    });
});

describe('an app with a PNG icon named in pwa.ts', () => {
    it('gets the ICO and the PNG, and no SVG link', async () => {
        put('src/custom/pwa-icon.svg', SVG);
        put('src/custom/brands/acme/icon.png', (await makeTabIcon('src/custom/pwa-icon.svg', root))!.files.get(TAB_ICON_FILES.png)!);
        const tab = await makeTabIcon('src/custom/brands/acme/icon.png', root);

        expect([...tab!.files.keys()]).toEqual([TAB_ICON_FILES.ico, TAB_ICON_FILES.png]);
        const html = withTabIcon(indexHtml, tab);
        expect(html).not.toContain(ARC_ICON);
        expect(html).not.toContain('favicon.svg');
    });
});

describe('the tab keeps today\'s icon', () => {
    it('with no app icon: no files made, index.html and the served favicon.ico as they were', async () => {
        const tab = await makeTabIcon(DEFAULT_PWA_ICON, root);
        expect(tab).toBeNull();
        expect(transformed(tabIcon(tab, DEFAULT_PWA_ICON))).toBe(indexHtml);
        expect(indexHtml).toContain(ARC_ICON);
        const { dir } = assembleSite(root, undefined, { extra: tab?.files });
        expect(readFileSync(join(dir, 'favicon.ico'), 'utf8')).toBe('arc-cms-icon');
    });

    it('when the app ships its own src/custom/site/favicon.ico, which it chose for the tab', async () => {
        put('src/custom/pwa-icon.svg', SVG);
        put(APP_FAVICON, 'app-favicon');
        expect(await makeTabIcon('src/custom/pwa-icon.svg', root)).toBeNull();
    });
});

describe('the build', () => {
    it('makes the tab icon from the PWA icon and serves it with the site, on npm run dev and in the build', () => {
        const vite = readFileSync(resolve(repo, 'vite.config.ts'), 'utf8');
        expect(vite).toContain('const tab = await makeTabIcon(pwaIcon);');
        expect(vite).toContain('arcSite({ notices: CUSTOM_NOTICES, extra: tab?.files })');
        expect(vite).toContain('tabIcon(tab, pwaIcon)');
    });
});
