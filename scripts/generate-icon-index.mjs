/**
 * Generates the icon picker's Font Awesome Free index from the
 * `@fortawesome/fontawesome-free` metadata package.
 *
 *   npm run icons:index
 *
 * Two files land in `public/assets/icons/`, and they are split on purpose:
 *
 *   fa-index.json — name, label, free styles and search terms. Fetched when
 *       the Icons tab opens. The grid previews each icon with the Font
 *       Awesome webfont the admin already loads, so browsing needs no paths.
 *
 *   fa-paths-{style}.json — viewBox and path data, one file per style.
 *       Fetched only when an admin actually picks an icon, to build the
 *       inline-SVG fallback stored alongside the class name. Most sessions
 *       never load one. Split by style because the combined file is 476KB
 *       gzipped against 226KB for solid alone, which is the common pick.
 *
 * Keep the version pinned to the Font Awesome stylesheet the published pages
 * load (functions/src/shared/site-settings.ts) — an index built from a newer
 * release would offer icons whose class names that stylesheet cannot render.
 *
 * A spec checks the committed output is in step with the installed metadata,
 * so a forgotten run fails the suite rather than shipping a stale index.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(root, 'public/assets/icons');

/** Only the classic family ships in Font Awesome Free. */
const FREE_FAMILY = 'classic';

/**
 * Builds both payloads from the raw metadata.
 *
 * Exported so the spec can rebuild from the installed package and compare
 * against the committed files without shelling out.
 */
export function buildIconData(metadata, version) {
    const icons = [];
    /** `{ solid: { star: [viewBox, path] }, … }` — one payload per style. */
    const pathsByStyle = {};

    for (const name of Object.keys(metadata).sort()) {
        const entry = metadata[name];

        // `familyStylesByLicense.free` is the authoritative list of what a
        // Free stylesheet can actually render. Reading `svgs` instead would
        // offer Pro-only styles that render as a blank box on the site.
        const freeStyles = (entry.familyStylesByLicense?.free ?? [])
            .filter((s) => s.family === FREE_FAMILY)
            .map((s) => s.style);

        if (freeStyles.length === 0) continue;

        // Aliases are how people actually search — "search" for
        // magnifying-glass, "trash" for trash-can. They are kept apart from
        // the keyword list rather than merged into it because an alias is a
        // far stronger signal: merged, a search for "search" ranks the
        // `searchengin` brand logo above the magnifying glass.
        const aliases = [...new Set(entry.aliases?.names ?? [])]
            .map((a) => String(a).toLowerCase())
            .sort();

        const terms = [...new Set(entry.search?.terms ?? [])]
            .map((t) => String(t).toLowerCase())
            .filter((t) => !aliases.includes(t))
            .sort();

        const icon = {
            n: name,
            l: entry.label ?? name,
            s: freeStyles,
            t: terms.join(' '),
        };
        // Omitted when empty — most icons have no alias, and the key costs
        // more than the handful that do.
        if (aliases.length > 0) icon.a = aliases.join(' ');

        icons.push(icon);

        for (const style of freeStyles) {
            const svg = entry.svgs?.[FREE_FAMILY]?.[style];
            if (!svg?.path || !svg?.viewBox) continue;
            (pathsByStyle[style] ??= {})[name] = [svg.viewBox.join(' '), svg.path];
        }
    }

    return {
        index: { version, icons },
        pathFiles: Object.fromEntries(
            Object.entries(pathsByStyle).map(([style, paths]) => [
                style,
                { version, style, paths },
            ]),
        ),
    };
}

function main() {
    const metadata = require('@fortawesome/fontawesome-free/metadata/icon-families.json');
    const pkg = JSON.parse(
        readFileSync(require.resolve('@fortawesome/fontawesome-free/package.json'), 'utf8'),
    );

    const { index, pathFiles } = buildIconData(metadata, pkg.version);

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'fa-index.json'), JSON.stringify(index));
    for (const [style, payload] of Object.entries(pathFiles)) {
        writeFileSync(join(OUT_DIR, `fa-paths-${style}.json`), JSON.stringify(payload));
    }

    console.log(`Font Awesome Free ${pkg.version}`);
    console.log(`  ${index.icons.length} icons →  public/assets/icons/fa-index.json`);
    for (const [style, payload] of Object.entries(pathFiles).sort()) {
        const count = Object.keys(payload.paths).length;
        console.log(`  ${count} ${style} paths →  public/assets/icons/fa-paths-${style}.json`);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
