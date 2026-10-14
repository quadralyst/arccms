import { loadHtml } from './lazy-cheerio.js';
import { type EntryOrder, sortForDisplay } from './display-order.js';

/**
 * Entries of another content type in a detail template: a loop container with
 * `data-arc-items-src="{type slug}"`, such as
 *
 *     <ul data-arc-loop="items" data-arc-items-src="events" data-limit="3">
 *
 * shows the newest (or arranged) published entries of `events` as cards, with
 * the same bindings as a list page's rows (content-cards.ts). The app and
 * publishing fill it the same way: both rename each such container to a loop of
 * its own (nameItemsFromTypeLoops), read the entries, pick them with
 * pickItemsFromType and build each row with cardData.
 *
 * Source of truth: src/app/core/utils/items-from-type.ts (the app fills the same
 * loops). Keep in sync manually; src/app/core/utils/items-from-type.spec.ts checks it.
 */

/** Rows when the container has no usable data-limit. */
export const ITEMS_FROM_TYPE_DEFAULT = 6;
/** The most rows one container shows, as for a card block on the home page. */
export const ITEMS_FROM_TYPE_MAX = 50;

/** One container to fill: its loop name after renaming, the type to read and how many rows. */
export interface ItemsFromTypeLoop {
    name: string;
    type: string;
    limit: number;
}

/** A data-limit as rows: a whole number from 1 up to the cap, else the default. */
export function itemsFromTypeLimit(raw: unknown): number {
    const n = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n) || n < 1) return ITEMS_FROM_TYPE_DEFAULT;
    return Math.min(n, ITEMS_FROM_TYPE_MAX);
}

/**
 * The type slugs a template reads entries of, each once, without parsing it.
 * A loop in an HTML comment reads nothing, so it does not count.
 */
export function itemsFromTypeSources(html: string | null | undefined): string[] {
    const types = new Set<string>();
    for (const match of (html || '').replace(/<!--[\s\S]*?-->/g, '').matchAll(/\bdata-arc-items-src\s*=\s*["']\s*([^"']+?)\s*["']/gi)) {
        types.add(match[1]);
    }
    return [...types];
}

/**
 * Renames each loop container that has `data-arc-items-src` to a loop of its
 * own (`arc-items-from-0`, `arc-items-from-1`...), so several of them, and a
 * plain `items` loop beside them, each get their own rows. Its data-limit
 * becomes the clamped row count. data-arc-items-src is removed everywhere; on
 * an element without data-arc-loop it does nothing. `html` is returned as it
 * is when the template has none.
 */
export function nameItemsFromTypeLoops(html: string): { html: string; loops: ItemsFromTypeLoop[] } {
    if (!html || !/data-arc-items-src/i.test(html)) return { html, loops: [] };
    const $ = loadHtml(html, { xmlMode: false }, false);
    const loops: ItemsFromTypeLoop[] = [];
    $('[data-arc-items-src]').each((_, element) => {
        const $el = $(element);
        const type = ($el.attr('data-arc-items-src') || '').trim();
        $el.removeAttr('data-arc-items-src');
        if ($el.attr('data-arc-loop') === undefined) return;
        // Not a slug (a path, a typo with spaces): no type to read, so no rows.
        if (!/^[A-Za-z0-9_-]+$/.test(type)) {
            $el.removeAttr('data-arc-loop').removeAttr('data-limit').empty();
            return;
        }
        const loop = { name: `arc-items-from-${loops.length}`, type, limit: itemsFromTypeLimit($el.attr('data-limit')) };
        loops.push(loop);
        $el.attr('data-arc-loop', loop.name);
        $el.attr('data-limit', String(loop.limit));
    });
    return { html: $.html(), loops };
}

/**
 * The entries a container shows, as a new array: published ones only, never
 * the page's own entry, in the type's display order, at most `limit`. The
 * entries come from the published collection, whose copies are always marked
 * published; one that is not is skipped all the same.
 */
export function pickItemsFromType<T extends Record<string, any>>(
    entries: readonly T[],
    order: EntryOrder,
    limit: number,
    excludeId = '',
): T[] {
    const shown = entries.filter((entry) => entry['publishedStatus'] !== false && !(excludeId && entry['id'] === excludeId));
    return sortForDisplay(shown, order).slice(0, limit);
}
