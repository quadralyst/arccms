/**
 * The media library's search box (docs/features/media.html, Find an image or
 * file; MF-D23). Firestore has no word search, so the library loads a tab's
 * details once and filters them here.
 *
 * Every word typed must appear somewhere in the item's title, notes, alt text
 * or file name, in any order. Case and accents are ignored, and a word
 * matches the start of a word or any part of one ("rep" finds "Annual
 * Report"), since admins rarely remember exact names.
 */

/** The fields an item is searched by. */
export interface MediaSearchFields {
    title?: string;
    notes?: string;
    alt?: string;
    name?: string;
}

/** Lower case, accents dropped, file-name dashes and dots turned into spaces. */
export function searchText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[-_.]+/g, ' ');
}

/** The words of a query, cleaned the same way as the text they are matched against. */
export function searchWords(query: string): string[] {
    return searchText(query).split(/\s+/).filter(Boolean);
}

/** True when every word of `query` is in one of the item's fields. An empty query matches everything. */
export function matchesSearch(item: MediaSearchFields, query: string): boolean {
    const words = searchWords(query);
    if (!words.length) return true;
    const haystack = searchText([item.title, item.notes, item.alt, item.name].filter(Boolean).join(' '));
    return words.every((word) => haystack.includes(word));
}

/** The items matching `query`, in their order. */
export function filterBySearch<T extends MediaSearchFields>(items: readonly T[], query: string): T[] {
    return items.filter((item) => matchesSearch(item, query));
}
