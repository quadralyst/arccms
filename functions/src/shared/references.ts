/**
 * Cited sources on a content item (docs/discoverability-spec.md, D-D11):
 * `references: { title, url }[]`, edited in the SEO tab, rendered as a
 * "Sources" list and emitted as `Article.citation`. Mirrored client-side
 * in src/shared/models/references.model.ts.
 */
export interface Reference {
    title: string;
    url: string;
}

/** Trims, drops entries without an http(s) URL, de-duplicates by URL. */
export function cleanReferences(raw: unknown): Reference[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: Reference[] = [];
    for (const item of raw) {
        const url = typeof item?.url === 'string' ? item.url.trim() : '';
        if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        out.push({ title: typeof item?.title === 'string' ? item.title.trim() : '', url });
    }
    return out;
}
