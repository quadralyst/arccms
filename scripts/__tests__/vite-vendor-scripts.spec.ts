/**
 * Bootstrap's script served with the app (scripts/vite-vendor-scripts.ts): the build
 * writes the file under a hashed name and index.html links it; the dev server serves it
 * from node_modules. No CDN.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BOOTSTRAP_SCRIPT, builtScriptPath, vendorScripts } from '../vite-vendor-scripts';

type Hook = (...args: unknown[]) => unknown;
const call = (hook: unknown, context: unknown, ...args: unknown[]) => (hook as Hook).call(context, ...args);

describe('vendorScripts', () => {
    const file = createRequire(import.meta.url).resolve(BOOTSTRAP_SCRIPT);

    it('writes the script under a name with its hash in a build, and links it deferred', () => {
        const plugin = vendorScripts();
        call(plugin.configResolved, {}, { command: 'build' });
        const emitFile = vi.fn();
        call(plugin.buildStart, { emitFile });
        const built = builtScriptPath(readFileSync(file));
        expect(built).toMatch(/^assets\/bootstrap\.bundle\.min-[\w-]{8}\.js$/);
        expect(emitFile).toHaveBeenCalledWith({ type: 'asset', fileName: built, source: readFileSync(file) });
        expect(call(plugin.transformIndexHtml, {}, '')).toEqual([
            { tag: 'script', attrs: { defer: true, src: `/${built}` }, injectTo: 'body' },
        ]);
    });

    it('serves it from node_modules in development, writing nothing', () => {
        const plugin = vendorScripts();
        call(plugin.configResolved, {}, { command: 'serve' });
        const emitFile = vi.fn();
        call(plugin.buildStart, { emitFile });
        expect(emitFile).not.toHaveBeenCalled();
        const [tag] = call(plugin.transformIndexHtml, {}, '') as { attrs: { src: string } }[];
        expect(tag.attrs.src).toBe(`/@fs/${file.replace(/^\//, '')}`);
    });

    it('changes the name when the script changes', () => {
        expect(builtScriptPath('a')).not.toBe(builtScriptPath('b'));
    });
});
