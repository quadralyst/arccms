import { describe, expect, it, vi } from 'vitest';
import { isAdminPage, routeCodeFiles, type CodeChunk } from './route-code';
import { resolvePwaConfig } from './pwa-config';
import { routeCode, ROUTE_CODE_WARN_BYTES } from '../../../../scripts/vite-route-code';

const chunk = (file: string, facade: string | null, imports: string[] = [], dynamicImports: string[] = [], isEntry = false): CodeChunk =>
    ({ file, facade, isEntry, imports, dynamicImports });

// main -> (lazy) member page -> shared ; main -> (lazy) admin page -> editor + shared
// main -> (lazy) app page -> (lazy) app child ; main -> (lazy) translation file
const GRAPH: CodeChunk[] = [
    chunk('assets/index-A.js', '/r/src/main.ts', ['assets/vendor-A.js'], [
        'assets/dashboard.page-A.js', 'assets/admin-content.page-A.js', 'assets/admin.page-A.js', 'assets/till.page-A.js', 'assets/hi-A.js',
    ], true),
    chunk('assets/vendor-A.js', null),
    chunk('assets/dashboard.page-A.js', '/r/src/app/pages/user/(dashboard)/dashboard.page.ts', ['assets/shared-A.js']),
    chunk('assets/admin-content.page-A.js', '/r/src/app/pages/admin/contents/index.page.ts', ['assets/editor-A.js', 'assets/shared-A.js'], ['assets/admin-only-lazy-A.js']),
    chunk('assets/admin.page-A.js', '/r/src/app/pages/admin.page.ts', ['assets/admin-shell-A.js']),
    chunk('assets/admin-shell-A.js', null),
    chunk('assets/editor-A.js', null),
    chunk('assets/admin-only-lazy-A.js', '/r/src/shared/components/editor/lazy.ts'),
    chunk('assets/shared-A.js', null),
    chunk('assets/till.page-A.js', '/r/src/custom/pages/till.page.ts', [], ['assets/till-child-A.js']),
    chunk('assets/till-child-A.js', '/r/src/custom/pages/till/child.ts'),
    chunk('assets/hi-A.js', '/r/src/assets/i18n/hi.json'),
];

describe('routeCodeFiles (specs/app-route-code-spec.md)', () => {
    it('visited adds nothing: today\'s behaviour', () => {
        expect(routeCodeFiles(GRAPH, 'visited').size).toBe(0);
    });

    it('app keeps every screen outside the admin area and what it imports, lazily too', () => {
        const files = routeCodeFiles(GRAPH, 'app');
        for (const f of ['assets/index-A.js', 'assets/vendor-A.js', 'assets/dashboard.page-A.js', 'assets/shared-A.js',
            'assets/till.page-A.js', 'assets/till-child-A.js', 'assets/hi-A.js']) expect(files, f).toContain(f);
    });

    it('app leaves out admin pages and code only they reach, but keeps code they share with others', () => {
        const files = routeCodeFiles(GRAPH, 'app');
        for (const f of ['assets/admin-content.page-A.js', 'assets/admin.page-A.js', 'assets/admin-shell-A.js', 'assets/editor-A.js', 'assets/admin-only-lazy-A.js']) {
            expect(files, f).not.toContain(f);
        }
        expect(files).toContain('assets/shared-A.js');
    });

    it('all keeps everything, and cycles do not loop', () => {
        expect(routeCodeFiles(GRAPH, 'all').size).toBe(GRAPH.length);
        const cyclic = [chunk('a.js', null, ['b.js'], [], true), chunk('b.js', null, ['a.js'])];
        expect([...routeCodeFiles(cyclic, 'app')].sort()).toEqual(['a.js', 'b.js']);
    });

    it('knows an admin page by its source file', () => {
        expect(isAdminPage('/x/src/app/pages/admin/users/index.page.ts')).toBe(true);
        expect(isAdminPage('C:\\x\\src\\app\\pages\\admin.page.ts')).toBe(true);
        expect(isAdminPage('/x/src/app/pages/user/profile.page.ts')).toBe(false);
        expect(isAdminPage(null)).toBe(false);
    });
});

describe('routeCode in src/custom/pwa.ts', () => {
    it('is visited unless the app says otherwise, and a typo stops the build', () => {
        expect(resolvePwaConfig({}, true).routeCode).toBe('visited');
        expect(resolvePwaConfig({ routeCode: 'app' }, true).routeCode).toBe('app');
        expect(() => resolvePwaConfig({ routeCode: 'everything' as never }, true)).toThrow('routeCode must be one of visited, app, all');
    });
});

describe('the Workbox manifest transform', () => {
    const entries = [
        { url: 'assets/index-A.js', size: 1000 }, { url: 'assets/dashboard.page-A.js', size: 200 },
        { url: 'assets/editor-A.js', size: 5000 }, { url: 'styles-A.css', size: 300 }, { url: 'assets/font.woff2', size: 100 },
    ];

    async function run(mode: 'app' | 'all', list = entries) {
        const log = vi.fn();
        const stored = routeCode(mode, log);
        (stored.recorder.generateBundle as unknown as (o: unknown, b: unknown) => void).call({}, {}, Object.fromEntries(GRAPH.map((c) => [c.file, {
            type: 'chunk', fileName: c.file, facadeModuleId: c.facade, isEntry: c.isEntry, imports: c.imports, dynamicImports: c.dynamicImports,
        }])));
        return { ...(await stored.transform(list)), log };
    }

    it('keeps every non-code file and the chosen code, and says how much', async () => {
        const { manifest, warnings, log } = await run('app');
        expect(manifest.map((e) => e.url)).toEqual(['assets/index-A.js', 'assets/dashboard.page-A.js', 'styles-A.css', 'assets/font.woff2']);
        expect(warnings).toEqual([]);
        expect(log).toHaveBeenCalledWith('PWA: 2 code files, 0.0 MB stored when the app installs or updates (routeCode: app).');
    });

    it('warns when more than 15 MB would be stored', async () => {
        const { warnings } = await run('all', [{ url: 'assets/index-A.js', size: ROUTE_CODE_WARN_BYTES + 1 }]);
        expect(warnings[0]).toContain('more than 15 MB');
    });
});
