/**
 * The browser tab's icon (docs/features/pwa.html#tab-icon), for the dev server and the
 * build alike. An app that has an icon (`icon` in src/custom/pwa.ts, or
 * src/custom/pwa-icon.svg or .png) gets its tab icon made from it, whether or not the
 * PWA is on: a 32px PNG, the SVG itself when the icon is one, and a favicon.ico for
 * old browsers and for pages that link no icon. They are served from the site root
 * with the website's files (arcSite's `extra`), and index.html links them with
 * `?v={hash}`, because Hosting lets browsers keep images for a year.
 *
 * With no app icon, or with the app's own src/custom/site/favicon.ico, the tab keeps
 * what index.html links today: /favicon.ico, Arc CMS's or the app's.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { generateFavicon, generateTransparentAsset } from '@vite-pwa/assets-generator/api';
import { DEFAULT_PWA_ICON } from '../src/app/core/pwa/pwa-config';

/** The served names, at the site root. */
export const TAB_ICON_FILES = { ico: 'favicon.ico', png: 'favicon-32x32.png', svg: 'favicon.svg' } as const;

/** The app's own favicon in its website folder (docs/website/overview.html): it wins. */
export const APP_FAVICON = 'src/custom/site/favicon.ico';

export interface TabIcon {
    /** Served path to content. */
    files: Map<string, Buffer>;
    /** A hash of the source image, for `?v=`. */
    version: string;
}

/** A square PNG of the image, transparent around it. */
async function png(image: Buffer, size: number): Promise<Buffer> {
    const made = await generateTransparentAsset('png', image, size, {
        padding: 0,
        resizeOptions: { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } },
        outputOptions: {},
    });
    return made.toBuffer();
}

/**
 * The tab icon's files made from `icon` (a path from `root`, as resolvePwaIcon gives it),
 * or null when the tab keeps index.html's own: the icon is Arc CMS's, or the app ships
 * src/custom/site/favicon.ico.
 */
export async function makeTabIcon(icon: string, root = process.cwd()): Promise<TabIcon | null> {
    if (icon === DEFAULT_PWA_ICON || existsSync(resolve(root, APP_FAVICON))) return null;
    const image = readFileSync(resolve(root, icon));
    const files = new Map<string, Buffer>([
        // 48px, as the PWA icon generator makes it.
        [TAB_ICON_FILES.ico, await generateFavicon('png', await png(image, 48))],
        [TAB_ICON_FILES.png, await png(image, 32)],
    ]);
    if (/\.svg$/i.test(icon)) files.set(TAB_ICON_FILES.svg, image);
    return { files, version: createHash('sha256').update(image).digest('hex').slice(0, 16) };
}

/** The `<link>`s for the tab icon: the ICO first, then the PNG, then the SVG, which browsers that can draw one prefer. */
export function tabIconLinks(tab: TabIcon): string {
    const v = `?v=${tab.version}`;
    const links = [
        `<link rel="icon" href="/${TAB_ICON_FILES.ico}${v}" sizes="48x48" />`,
        `<link rel="icon" type="image/png" href="/${TAB_ICON_FILES.png}${v}" sizes="32x32" />`,
    ];
    if (tab.files.has(TAB_ICON_FILES.svg)) links.push(`<link rel="icon" type="image/svg+xml" href="/${TAB_ICON_FILES.svg}${v}" />`);
    return links.join('\n  ');
}

/** index.html with the app's tab icon in place of the one it links, or as it is when the app has none. */
export function withTabIcon(html: string, tab: TabIcon | null): string {
    if (!tab) return html;
    const links = tabIconLinks(tab);
    const linked = /<link\s+rel="icon"[^>]*>/;
    return linked.test(html) ? html.replace(linked, links) : html.replace('</head>', `  ${links}\n</head>`);
}

/**
 * The Vite plugin: links the tab icon in index.html, and restarts the dev server when
 * the icon's file changes, so the tab icon is made again.
 */
export function tabIcon(tab: TabIcon | null, icon: string): Plugin {
    return {
        name: 'arc-tab-icon',
        transformIndexHtml: { order: 'pre', handler: (html: string) => withTabIcon(html, tab) },
        configureServer(server) {
            if (!tab) return;
            const file = resolve(icon);
            server.watcher.add(file);
            server.watcher.on('change', (changed) => {
                if (resolve(changed) === file) void server.restart();
            });
        },
    };
}
