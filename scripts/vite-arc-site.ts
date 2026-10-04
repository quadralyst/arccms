/**
 * The public website's files in Vite (scripts/arc-site.mjs, specs/own-website-spec.md).
 *
 * - Assembles core's public/ and the app's src/custom/site/ into .arc-build/public
 *   and makes that Vite's public folder, so `npm run dev` serves and `npm run build`
 *   ships the app's files wherever it has them, core's everywhere else.
 * - Re-assembles when a file in either changes while the dev server runs.
 * - Provides `virtual:arc-site`: the header, the footer, the sign-in panel and
 *   the manifest, for the browser app.
 *
 * Tests load it with `assemble: false`, for the virtual module only.
 */
import { resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { assembleSite, isSiteSource, siteModule } from './arc-site.mjs';

const VIRTUAL = 'virtual:arc-site';
const RESOLVED = `\0${VIRTUAL}`;

/** Changes to these served paths change what `virtual:arc-site` exports. */
const MODULE_PATHS = ['_site/header.html', '_site/footer.html', '_site/sign-in.html', '_site/site.json'];

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
