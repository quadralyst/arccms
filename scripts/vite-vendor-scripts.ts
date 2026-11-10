/**
 * Bootstrap's script on every page (window.bootstrap, its dropdowns, modals and
 * collapses by data-bs-* attributes), served with the app instead of from a CDN
 * (docs/contributing/frontend-notes.html). Core uses none of it; an app's own pages may.
 *
 * A classic deferred script, as the CDN one was, so `window.bootstrap` is there for an
 * app's code. It is kept out of the first script (src/app/first-script.spec.ts): the
 * build writes the file as it ships, under a name with a hash of its content
 * (assets/bootstrap.bundle.min-<hash>.js, kept a year by browsers and by the PWA), and
 * index.html links it. The dev server serves it from node_modules.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

/** The script, by its package path. */
export const BOOTSTRAP_SCRIPT = 'bootstrap/dist/js/bootstrap.bundle.min.js';

/** Where the build writes a script: its name with eight characters of its content's hash. */
export function builtScriptPath(source: Buffer | string, name = 'bootstrap.bundle.min'): string {
    const hash = createHash('sha256').update(source).digest('base64url').slice(0, 8);
    return `assets/${name}-${hash}.js`;
}

export function vendorScripts(): Plugin {
    const file = createRequire(import.meta.url).resolve(BOOTSTRAP_SCRIPT);
    const source = readFileSync(file);
    const built = builtScriptPath(source);
    let serving = false;
    return {
        name: 'arc-vendor-scripts',
        applyToEnvironment: (env) => env.name === 'client',
        configResolved(config) {
            serving = config.command === 'serve';
        },
        buildStart() {
            if (!serving) this.emitFile({ type: 'asset', fileName: built, source });
        },
        transformIndexHtml: () => [
            { tag: 'script', attrs: { defer: true, src: serving ? `/@fs/${file.replace(/\\/g, '/').replace(/^\//, '')}` : `/${built}` }, injectTo: 'body' },
        ],
    };
}
