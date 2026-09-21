/**
 * Cited sources on a content item (docs/discoverability-spec.md, D-D11).
 * Mirrors functions/src/shared/references.ts.
 */
export interface IReference {
    title: string;
    url: string;
}

/** Trims, drops entries without an http(s) URL, de-duplicates by URL. */
export function cleanReferences(raw: unknown): IReference[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: IReference[] = [];
    for (const item of raw as Array<Partial<IReference> | null>) {
        const url = typeof item?.url === 'string' ? item.url.trim() : '';
        if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        out.push({ title: typeof item?.title === 'string' ? item.title.trim() : '', url });
    }
    return out;
}
