/**
 * An item's URL slug (`/articles/{slug}`): lowercase letters, digits and single
 * hyphens, nothing at either end. The editor builds one from the title and
 * cleans any slug typed by hand with this, so a slug never carries spaces or
 * capitals into a published address.
 */
export function toUrlSlug(text: unknown): string {
    return String(text ?? '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * The next free form of a slug whose address is taken: `pricing-guide` becomes
 * `pricing-guide-2`, and `pricing-guide-2` becomes `pricing-guide-3`.
 */
export function nextUrlSlug(slug: string): string {
    const match = /^(.*?)-(\d+)$/.exec(slug);
    return match ? `${match[1]}-${Number(match[2]) + 1}` : `${slug}-2`;
}
