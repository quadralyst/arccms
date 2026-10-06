/**
 * Which code files the service worker stores ahead (specs/app-route-code-spec.md, R-D2 to R-D4).
 * Plain TypeScript with no imports: vite.config.ts runs it on the build's own chunk graph.
 *
 * `app` walks from the main bundle along every import, except a lazy import into an admin
 * page, so the admin's screens (and code only they use) are left to load when opened.
 */
import type { RouteCodeMode } from './pwa-config';

/** One built code file, as Rollup reports it. */
export interface CodeChunk {
    /** The output file, such as `assets/index-C0k4xnXa.js`. */
    file: string;
    /** The source module the chunk is the entry for, if any (a lazy page's file). */
    facade: string | null;
    isEntry: boolean;
    /** Files it imports statically: needed whenever it runs. */
    imports: readonly string[];
    /** Files it may import later: lazy routes and the like. */
    dynamicImports: readonly string[];
}

/** A source file that is an admin page: its lazy import is not followed for `app`. */
export function isAdminPage(facade: string | null): boolean {
    if (!facade) return false;
    const path = facade.replace(/\\/g, '/');
    return path.includes('/src/app/pages/admin/') || path.endsWith('/src/app/pages/admin.page.ts');
}

/** The code files to store ahead for a mode; `visited` stores none beyond today's. */
export function routeCodeFiles(chunks: readonly CodeChunk[], mode: RouteCodeMode): Set<string> {
    if (mode === 'visited') return new Set();
    if (mode === 'all') return new Set(chunks.map((c) => c.file));
    const byFile = new Map(chunks.map((c) => [c.file, c]));
    const keep = new Set<string>();
    const queue = chunks.filter((c) => c.isEntry).map((c) => c.file);
    while (queue.length) {
        const file = queue.shift()!;
        if (keep.has(file)) continue;
        const chunk = byFile.get(file);
        if (!chunk) continue;
        keep.add(file);
        queue.push(...chunk.imports);
        for (const lazy of chunk.dynamicImports) {
            if (!isAdminPage(byFile.get(lazy)?.facade ?? null)) queue.push(lazy);
        }
    }
    return keep;
}
