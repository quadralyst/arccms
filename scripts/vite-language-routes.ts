/**
 * Warns when an app page's address is also a language code, such as /de: the
 * language routes never take an address a page uses (src/app/guards/language.guard.ts),
 * so the site could not publish that language under /de/. The Localization settings
 * page refuses the code too; this says so before anyone tries
 * (docs/features/languages.html).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { SUPPORTED_LANGUAGES } from '../src/shared/constants/languages';

/** The first segments of the literal paths in src/custom/routes.ts. */
export function routeFileSegments(source: string): string[] {
    return [...source.matchAll(/\bpath:\s*(['"`])([^'"`]*)\1/g)]
        .map((match) => match[2].split('/')[0])
        .filter((first) => first && !first.startsWith(':') && first !== '**');
}

/** The first segments the file-based pages in a folder such as src/custom/pages give. */
export function pageFileSegments(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const segments: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (/^\(.*\)$/.test(name)) segments.push(...pageFileSegments(path));
            else if (!name.startsWith('[')) segments.push(name);
        } else if (name.endsWith('.page.ts')) {
            const first = name.slice(0, -'.page.ts'.length).split('.')[0];
            if (first !== 'index' && !first.startsWith('[') && !/^\(.*\)$/.test(first)) segments.push(first);
        }
    }
    return segments;
}

/** One warning per app address that is also a language code in the catalogue. */
export function languageRouteClashes(segments: string[]): string[] {
    const seen = new Set<string>();
    return segments
        .map((segment) => segment.toLowerCase())
        .filter((segment) => !seen.has(segment) && seen.add(segment))
        .flatMap((segment) => {
            const language = SUPPORTED_LANGUAGES.find((l) => l.code === segment);
            return language
                ? [`The app's page /${segment} has the address of the language code for ${language.label}. ` +
                    `The site cannot publish ${language.label} under /${segment}/ while that page exists; give the page another address.`]
                : [];
        });
}

/** The Vite plugin: warns when the dev server or the build starts. */
export function languageRouteCheck(root = process.cwd()): Plugin {
    return {
        name: 'arc-language-routes',
        buildStart() {
            const routesFile = join(root, 'src/custom/routes.ts');
            const segments = [
                ...(existsSync(routesFile) ? routeFileSegments(readFileSync(routesFile, 'utf8')) : []),
                ...pageFileSegments(join(root, 'src/custom/pages')),
            ];
            for (const warning of languageRouteClashes(segments)) this.warn(warning);
        },
    };
}
