/**
 * The script every page loads first (F34): what src/main.ts imports, file by file, with
 * no dynamic import() or lazy route. Libraries only some pages use stay out of it, so a
 * phone or a new tablet shows the first page sooner. docs/contributing/frontend-notes.html.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

/** Packages kept out of the first script, and where they load instead. */
const KEPT_OUT: [RegExp, string][] = [
    [/^@angular\/material(\/|$)/, 'admin pages (the paginator labels: useTranslatedPaginator in admin.page.ts)'],
    [/^@angular\/cdk(\/|$)/, 'the pages that use it'],
    [/^@angular\/forms(\/|$)/, 'the pages with forms (import type for a type)'],
    [/^@angular\/animations(\/|$)/, 'provideAnimationsAsync()'],
    [/^@angular\/platform-browser\/animations$/, 'provideAnimationsAsync() from @angular/platform-browser/animations/async'],
    [/^@angular\/fire\/storage$/, 'ArcStorage (src/app/core/config/arc-storage.ts)'],
    [/^(@tiptap|pdfjs-dist|jszip)(\/|$)/, 'the editor, PDF and data pages'],
];

/** Static imports and re-exports of a file, without `import type` and dynamic import(). */
function staticImports(code: string): string[] {
    const found: string[] = [];
    const re = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
    for (const match of code.matchAll(re)) if (!match[1]) found.push(match[2]);
    return found;
}

function resolveFile(from: string, spec: string): string | null {
    const base = resolve(dirname(from), spec);
    for (const candidate of [base, `${base}.ts`, resolve(base, 'index.ts')]) {
        if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
    }
    return null;
}

/** Every package the first script imports, with the file that imports it. */
function firstScriptPackages(): Map<string, string> {
    const packages = new Map<string, string>();
    const seen = new Set<string>();
    const visit = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        for (const spec of staticImports(readFileSync(file, 'utf8'))) {
            if (spec.startsWith('.')) {
                const next = resolveFile(file, spec);
                if (next) visit(next);
            } else if (!packages.has(spec)) {
                packages.set(spec, relative(ROOT, file));
            }
        }
    };
    visit(resolve(ROOT, 'src/main.ts'));
    return packages;
}

describe('the first script', () => {
    it('reads the shell through the app config and its components', () => {
        const packages = firstScriptPackages();
        expect([...packages.keys()]).toEqual(expect.arrayContaining(['@angular/core', '@angular/fire/firestore', '@angular/fire/auth']));
    });

    it('leaves out the libraries only some pages use', () => {
        const offenders = [...firstScriptPackages()]
            .flatMap(([spec, file]) => KEPT_OUT.filter(([re]) => re.test(spec)).map(([, instead]) => `${file} imports ${spec}: load it from ${instead}`));
        expect(offenders).toEqual([]);
    });

    it('loads the feedback panel once the page is idle', () => {
        const app = readFileSync(resolve(ROOT, 'src/app/app.ts'), 'utf8');
        expect(app).toMatch(/@defer \(on idle\) \{\s*<arc-feedback \/>\s*\}/);
    });
});
