/**
 * Loads the generated Font Awesome index and turns a chosen icon into a
 * stored token.
 *
 * The two payloads are fetched, not imported, so the bundler never inlines
 * them: the index is 191KB and the path files up to 800KB, which as a lazy
 * chunk would still be parsed as JavaScript. Fetched as static assets they
 * are served with the hosting cache headers and never touch a public
 * visitor's page — only an admin who opens the picker pays for them.
 *
 * Regenerate the assets with `npm run icons:index`.
 */

import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
    ArcIcon,
    buildFaMarkup,
    faClasses,
    FaIconStyle,
    FaIndex,
    FaIndexEntry,
    FaPathFile,
    POPULAR_ICON_NAMES,
} from '../models/icon.model';
import { sanitizeSvg } from '../utils/sanitize-svg';

const INDEX_URL = '/assets/icons/fa-index.json';
const PATHS_URL = (style: FaIconStyle) => `/assets/icons/fa-paths-${style}.json`;

/**
 * Whether `haystack` contains `needle` as a whole space-separated word.
 *
 * Word-bounded so "car" does not match the keyword "racecar" — an unbounded
 * match buries the real `car` icon under everything that merely mentions one.
 */
function hasWord(haystack: string | undefined, needle: string): boolean {
    if (!haystack) return false;
    return haystack === needle
        || haystack.startsWith(`${needle} `)
        || haystack.endsWith(` ${needle}`)
        || haystack.includes(` ${needle} `);
}

/** Curated name to its position, for ranking the no-search grid. */
const POPULAR_RANK = new Map(POPULAR_ICON_NAMES.map((name, i) => [name, i]));

/** One search hit: the index entry plus the style it matched in. */
export interface IconSearchResult {
    entry: FaIndexEntry;
    style: FaIconStyle;
    classes: string;
}

@Injectable({ providedIn: 'root' })
export class IconLibraryService {
    private platform = inject(PLATFORM_ID);

    /**
     * In-flight or settled loads, kept so opening the picker a second time is
     * free and two rapid opens do not race two fetches.
     */
    private indexPromise: Promise<FaIndex | null> | null = null;
    private pathPromises = new Map<FaIconStyle, Promise<FaPathFile | null>>();

    /** The search index, fetched once per session. Null if it could not load. */
    loadIndex(): Promise<FaIndex | null> {
        if (!isPlatformBrowser(this.platform)) return Promise.resolve(null);

        this.indexPromise ??= fetch(INDEX_URL)
            .then((res) => (res.ok ? (res.json() as Promise<FaIndex>) : null))
            .catch((error) => {
                console.error('Failed to load the icon index', error);
                // Clear so a later open retries rather than caching the failure.
                this.indexPromise = null;
                return null;
            });

        return this.indexPromise;
    }

    /**
     * Ranked matches for `term`, restricted to `style` when given.
     *
     * Ranking matters more than it looks: searching "user" against 1,390
     * solid icons matches 80-odd, and an unranked list buries `user` itself
     * under `user-astronaut`. Exact name first, then name prefix, then name
     * substring, then a keyword hit — which is what puts `magnifying-glass`
     * at the top for "search", its alias rather than its name.
     */
    search(
        index: FaIndex | null,
        term: string,
        style: FaIconStyle | 'all',
        limit = Number.POSITIVE_INFINITY,
    ): IconSearchResult[] {
        if (!index) return [];

        const needle = term.trim().toLowerCase();
        const scored: { result: IconSearchResult; score: number }[] = [];

        // With no term, rank the curated set first — see POPULAR_ICON_NAMES for
        // why an unranked alphabetical grid is a poor opening screen.
        const popularity = needle ? null : POPULAR_RANK;

        for (const entry of index.icons) {
            const styles = style === 'all' ? entry.s : entry.s.includes(style) ? [style] : [];
            if (styles.length === 0) continue;

            const score = needle
                ? this.score(entry, needle)
                : popularity!.get(entry.n) ?? POPULAR_ICON_NAMES.length;
            if (score < 0) continue;

            for (const matched of styles) {
                scored.push({
                    result: { entry, style: matched, classes: faClasses(matched, entry.n) },
                    score,
                });
            }
        }

        // Stable within a score band: the index is name-sorted, so equal
        // matches stay alphabetical instead of shuffling between keystrokes.
        // Everything outside the curated set shares one score, so the tail of
        // the no-search grid is still the full library in name order.
        scored.sort((a, b) => a.score - b.score);
        return scored.slice(0, limit).map((s) => s.result);
    }

    /**
     * Lower is better; -1 means no match.
     *
     * The order is what makes the picker feel right. An exact alias outranks
     * a name that merely starts with the term, because that is the case of
     * typing "search": `magnifying-glass` is what you want, and
     * `searchengin`, `researchgate` and `folder-tree` are what an unweighted
     * match gives you instead.
     */
    private score(entry: FaIndexEntry, needle: string): number {
        const name = entry.n;
        if (name === needle) return 0;
        if (hasWord(entry.a, needle)) return 1;
        if (name.startsWith(needle)) return 2;
        if (name.includes(needle)) return 3;
        if (entry.l.toLowerCase().includes(needle)) return 4;
        if (hasWord(entry.t, needle)) return 5;
        return -1;
    }

    /**
     * The full token for a chosen icon, with the inline-SVG fallback attached
     * when the path data is available.
     *
     * A missing path file is not an error worth blocking on — the class name
     * is what actually renders, and the fallback only matters on a site that
     * has dropped the Font Awesome stylesheet. So the token is returned
     * either way, just without `markup`.
     */
    async buildToken(entry: FaIndexEntry, style: FaIconStyle): Promise<ArcIcon> {
        const icon: ArcIcon = {
            set: 'fa',
            name: entry.n,
            style,
            classes: faClasses(style, entry.n),
            label: entry.l,
        };

        const file = await this.loadPaths(style);
        const path = file?.paths?.[entry.n];
        if (path) {
            const markup = sanitizeSvg(buildFaMarkup(path[0], path[1]));
            if (markup) icon.markup = markup;
        }

        return icon;
    }

    /** One style's path payload, fetched on first use. */
    private loadPaths(style: FaIconStyle): Promise<FaPathFile | null> {
        if (!isPlatformBrowser(this.platform)) return Promise.resolve(null);

        if (!this.pathPromises.has(style)) {
            const promise = fetch(PATHS_URL(style))
                .then((res) => (res.ok ? (res.json() as Promise<FaPathFile>) : null))
                .catch((error) => {
                    console.error(`Failed to load ${style} icon paths`, error);
                    this.pathPromises.delete(style);
                    return null;
                });
            this.pathPromises.set(style, promise);
        }

        return this.pathPromises.get(style)!;
    }
}
