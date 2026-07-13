/**
 * Collapse EmailTemplate docs that share the same `type` to a single entry.
 *
 * Per-waitlist templates (and any accidental duplicate docs) reuse a small set
 * of `type` keys, so the admin template pickers can otherwise list the same
 * logical template several times. Senders resolve a template with
 * `where('type','==',…).limit(1)`, so the pickers should likewise surface one
 * entry per type. Falls back to the doc `id` when a doc has no `type`. Order is
 * preserved and the first occurrence of each key wins.
 */
export function dedupeTemplatesByType<T extends { id?: string; type?: string }>(docs: T[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const d of docs) {
        const key = d.type || d.id || '';
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(d);
    }
    return out;
}
