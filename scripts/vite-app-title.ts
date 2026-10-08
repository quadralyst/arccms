/**
 * The tab's text before the app starts (index.html): the app's name from
 * src/custom/brand.ts when it has one, else the neutral one index.html ships; never
 * Arc CMS's. Once the app runs, it names each page itself
 * (src/app/core/brand/brand-title.strategy.ts, docs/app/admin-look.html).
 */
import type { Plugin } from 'vite';

/** index.html with the app's name as its title, or as it is when the app has none. */
export function withAppTitle(html: string, name: string | undefined): string {
    const title = typeof name === 'string' ? name.trim() : '';
    if (!title) return html;
    const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return html.replace(/<title>[^<]*<\/title>/, `<title>${escaped}</title>`);
}

/** The Vite plugin, for the dev server and the build alike. */
export function appTitle(name: string | undefined): Plugin {
    return {
        name: 'arc-app-title',
        transformIndexHtml: { order: 'pre', handler: (html: string) => withAppTitle(html, name) },
    };
}
