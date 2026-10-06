/**
 * Route code stored ahead (specs/app-route-code-spec.md): records the browser build's
 * chunk graph, and gives Workbox a manifest transform that keeps the code files
 * `routeCodeFiles()` chooses. Says how much is stored, and warns when it is a lot.
 */
import type { Plugin } from 'vite';
import { routeCodeFiles, type CodeChunk } from '../src/app/core/pwa/route-code';
import type { RouteCodeMode } from '../src/app/core/pwa/pwa-config';

/** More than this stored on install is worth a second look (R-D5). */
export const ROUTE_CODE_WARN_BYTES = 15 * 1024 * 1024;

interface ManifestEntry { url: string; size: number; revision?: string | null }

export function routeCode(mode: RouteCodeMode, log: (line: string) => void = console.log) {
    let chunks: CodeChunk[] = [];

    const recorder: Plugin = {
        name: 'arc-route-code',
        apply: 'build',
        applyToEnvironment: (env) => env.name === 'client',
        generateBundle(_options, bundle) {
            chunks = Object.values(bundle).flatMap((item) => item.type === 'chunk'
                ? [{
                    file: item.fileName,
                    facade: item.facadeModuleId ?? null,
                    isEntry: item.isEntry,
                    imports: item.imports,
                    dynamicImports: item.dynamicImports,
                }]
                : []);
        },
    };

    /** Workbox `manifestTransforms`: keep every non-code file, and the chosen code files. */
    const transform = async (entries: ManifestEntry[]) => {
        const keep = routeCodeFiles(chunks, mode);
        const manifest = entries.filter((e) => !e.url.endsWith('.js') || /(^|\/)assets\/index-[\w-]+\.js$/.test(e.url) || keep.has(e.url));
        const code = manifest.filter((e) => e.url.endsWith('.js'));
        const bytes = manifest.reduce((sum, e) => sum + (e.size || 0), 0);
        log(`PWA: ${code.length} code files, ${(bytes / 1024 / 1024).toFixed(1)} MB stored when the app installs or updates (routeCode: ${mode}).`);
        const warnings = bytes > ROUTE_CODE_WARN_BYTES
            ? [`PWA: more than ${ROUTE_CODE_WARN_BYTES / 1024 / 1024} MB is stored on install. Consider routeCode: 'app' rather than 'all' (docs/app/pwa.html).`]
            : [];
        return { manifest, warnings };
    };

    return { recorder, transform, chunks: () => chunks };
}
