/**
 * Guards the generated icon assets against drift.
 *
 * `public/assets/icons/*.json` is committed output, built from the installed
 * `@fortawesome/fontawesome-free` metadata by `npm run icons:index`. Nothing
 * about the running app makes a stale index obvious — the picker just quietly
 * lacks whatever was added, or offers a class name the stylesheet cannot
 * render. This is where that becomes visible instead.
 *
 * It also pins the index to the Font Awesome release the published pages
 * actually load, which is the failure that would be hardest to diagnose: an
 * icon that previews correctly in the admin and renders as a blank box on the
 * live site.
 */

import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { POPULAR_ICON_NAMES } from '../shared/models/icon.model';
import { IconLibraryService } from '../shared/services/icon-library.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
// @ts-expect-error — plain .mjs build script, no types
import { buildIconData } from '../../scripts/generate-icon-index.mjs';

const require = createRequire(import.meta.url);
const root = join(__dirname, '../..');
const ICONS_DIR = join(root, 'public/assets/icons');

/**
 * The Font Awesome release the published pages load, from the default
 * `cssUrls` in functions/src/shared/site-settings.ts.
 */
const STYLESHEET_VERSION = '6.5.1';

function readJson(name: string): any {
    return JSON.parse(readFileSync(join(ICONS_DIR, name), 'utf8'));
}

const pkg = JSON.parse(
    readFileSync(require.resolve('@fortawesome/fontawesome-free/package.json'), 'utf8'),
);
const metadata = require('@fortawesome/fontawesome-free/metadata/icon-families.json');
const rebuilt = buildIconData(metadata, pkg.version);

describe('generated icon assets', () => {
    it('is built from the Font Awesome release the site loads', () => {
        // Bumping the package without bumping the stylesheet (or the reverse)
        // ships icons the live pages cannot draw.
        expect(pkg.version).toBe(STYLESHEET_VERSION);
    });

    it('has a committed index matching the installed metadata', () => {
        // Regenerate with `npm run icons:index`.
        expect(readJson('fa-index.json')).toEqual(rebuilt.index);
    });

    it.each(['solid', 'regular', 'brands'])('has a committed %s path file', (style) => {
        expect(readJson(`fa-paths-${style}.json`)).toEqual(rebuilt.pathFiles[style]);
    });

    it('offers only styles that exist in Font Awesome Free', () => {
        const styles = new Set(rebuilt.index.icons.flatMap((icon: any) => icon.s));
        expect([...styles].sort()).toEqual(['brands', 'regular', 'solid']);
    });

    it('has path data for every icon and style the index offers', () => {
        const missing: string[] = [];

        for (const icon of rebuilt.index.icons) {
            for (const style of icon.s) {
                if (!rebuilt.pathFiles[style]?.paths?.[icon.n]) {
                    missing.push(`${style}:${icon.n}`);
                }
            }
        }

        // A gap here means an icon that browses fine but stores no inline-SVG
        // fallback, which only shows up on a site without the stylesheet.
        expect(missing).toEqual([]);
    });

    it('carries aliases separately from keywords', () => {
        const byName = new Map(rebuilt.index.icons.map((i: any) => [i.n, i]));

        // `search` is an alias of magnifying-glass, not its name. It has to
        // land in `a`, which outranks a name match — in `t` it would rank
        // below the `searchengin` brand logo.
        expect((byName.get('magnifying-glass') as any).a).toBe('search');
        expect((byName.get('car') as any).a).toBe('automobile');

        // Most icons have no alias at all, so the key must stay absent rather
        // than present-and-empty — the search treats '' and undefined alike,
        // but 1,370 empty strings is 1,370 wasted bytes in the index.
        expect((byName.get('star') as any).a).toBeUndefined();
    });

    it('ranks the aliased icon first for the aliases people actually type', () => {
        // The end-to-end guard on the split: these are the queries a stale or
        // re-merged index would quietly get wrong.
        // Constructed through TestBed: the service injects PLATFORM_ID.
        TestBed.configureTestingModule({});
        const service = TestBed.inject(IconLibraryService);
        const first = (term: string) => service.search(rebuilt.index, term, 'all', 1)[0]?.entry.n;

        expect(first('search')).toBe('magnifying-glass');
        expect(first('zoom')).toBe('magnifying-glass');
        expect(first('automobile')).toBe('car');
        expect(first('trash-alt')).toBe('trash-can');
    });

    it('gives every curated popular icon a real entry in the index', () => {
        const names = new Set(rebuilt.index.icons.map((i: any) => i.n));
        const missing = POPULAR_ICON_NAMES.filter(name => !names.has(name));

        // A curated name Font Awesome has since renamed would silently vanish
        // from the picker's opening screen.
        expect(missing).toEqual([]);
    });
});
