/**
 * The public website's files in Vite (scripts/arc-site.mjs, specs/own-website-spec.md).
 *
 * - Assembles core's public/ and the app's src/custom/site/ into .arc-build/public
 *   and makes that Vite's public folder, so `npm run dev` serves and `npm run build`
 *   ships the app's files wherever it has them, core's everywhere else.
 * - Re-assembles when a file in either changes while the dev server runs.
 * - Provides `virtual:arc-site`: the header, the footer, the sign-in panel and
 *   the manifest, for the browser app.
 * - In `npm run dev`, serves the live site's manifest at /__arc/live-site.json, so
 *   the admin can warn when local site files differ from the live ones that
 *   publishing reads (src/app/core/site/site-drift.ts). Hosting sends no CORS
 *   headers, so the browser cannot fetch it from the live site itself.
 *
 * Tests load it with `assemble: false`, for the virtual module only.
 */
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { assembleSite, isSiteSource, siteModule } from './arc-site.mjs';

const VIRTUAL = 'virtual:arc-site';
const RESOLVED = `\0${VIRTUAL}`;

/** Changes to these served paths change what `virtual:arc-site` exports. */
const MODULE_PATHS = ['_site/header.html', '_site/footer.html', '_site/sign-in.html', '_site/site.json'];

/** Where the dev server serves a live site's manifest (`?site=<hosting site>`). */
export const LIVE_MANIFEST_PATH = '/__arc/live-site.json';

/** A Firebase Hosting site's manifest URL, or null for a name that is not a site name. */
export function liveManifestUrl(site: string): string | null {
    return /^[a-z0-9][a-z0-9-]{0,62}$/.test(site) ? `https://${site}.web.app/_site/site.json` : null;
}

/**
 * The answer for LIVE_MANIFEST_PATH: the live manifest (200), `{ "missing": true }`
 * when the live site has none yet, as a site deployed before /_site/ existed
 * (404), or 502 when the live site cannot be reached.
 */
export async function liveManifestResponse(
    site: string,
    fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; body: string }> {
    const url = liveManifestUrl(site);
    if (!url) return { status: 400, body: JSON.stringify({ error: 'Not a hosting site name.' }) };
    try {
        const res = await fetchImpl(url, { cache: 'no-store' });
        const text = res.ok ? await res.text() : '';
        try {
            const manifest = JSON.parse(text);
            if (manifest && typeof manifest.files === 'object') return { status: 200, body: JSON.stringify(manifest) };
        } catch {
            // The app shell (a rewrite) or an error page: no manifest.
        }
        return { status: 404, body: JSON.stringify({ missing: true }) };
    } catch {
        return { status: 502, body: JSON.stringify({ error: `Could not reach ${url}.` }) };
    }
}

async function serveLiveManifest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const site = new URL(req.url ?? '', 'http://localhost').searchParams.get('site') ?? '';
    const { status, body } = await liveManifestResponse(site);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
}

function warnIgnored(ignored: string[], warn: (message: string) => void): void {
    if (ignored.length) {
        warn(`[arc-site] Not a website file, so not served (see docs/website/overview.html):\n  ${ignored.join('\n  ')}`);
    }
}

export function arcSite({ assemble = true }: { assemble?: boolean } = {}): Plugin {
    let root = process.cwd();
    return {
        name: 'arc-site',
        config(config) {
            root = resolve(config.root ?? process.cwd());
            if (!assemble) return;
            // At config time, before Vite reads its public folder.
            const { dir, ignored } = assembleSite(root);
            warnIgnored(ignored, console.warn);
            return { publicDir: dir };
        },
        resolveId(id) {
            return id === VIRTUAL ? RESOLVED : undefined;
        },
        load(id) {
            return id === RESOLVED ? siteModule(root) : undefined;
        },
        configureServer(server: ViteDevServer) {
            if (!assemble) return;
            server.middlewares.use(LIVE_MANIFEST_PATH, (req, res) => { void serveLiveManifest(req, res); });
            server.watcher.add([resolve(root, 'public'), resolve(root, 'src/custom/site')]);
            const onChange = (file: string) => {
                if (!isSiteSource(root, file)) return;
                try {
                    const { changed, ignored } = assembleSite(root);
                    warnIgnored(ignored, (message) => server.config.logger.warn(message));
                    if (!changed.some((path) => MODULE_PATHS.includes(path))) return;
                    for (const env of Object.values(server.environments)) {
                        const mod = env.moduleGraph.getModuleById(RESOLVED);
                        if (mod) env.moduleGraph.invalidateModule(mod);
                    }
                    server.ws.send({ type: 'full-reload' });
                } catch (error) {
                    // A broken strings file, say: keep serving the last good copy.
                    server.config.logger.error(`[arc-site] ${(error as Error).message}`);
                }
            };
            server.watcher.on('add', onChange).on('change', onChange).on('unlink', onChange);
        },
    };
}
