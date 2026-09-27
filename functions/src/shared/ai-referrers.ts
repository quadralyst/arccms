/**
 * Referrer domains that mean "a visitor arrived from an AI assistant"
 * (docs/discoverability-spec.md, D-D14). Crawler hits cannot be counted on
 * static Hosting, but arrivals can: GA4's `sessionSource` carries the
 * referring host, and these are the hosts assistants send people from.
 * Add one line per new assistant.
 */
export interface AiReferrer {
    /** Substring matched against the lower-cased session source. */
    match: string;
    label: string;
}

export const AI_REFERRERS: readonly AiReferrer[] = [
    { match: 'chatgpt.com', label: 'ChatGPT' },
    { match: 'chat.openai.com', label: 'ChatGPT' },
    { match: 'openai.com', label: 'OpenAI' },
    { match: 'perplexity.ai', label: 'Perplexity' },
    { match: 'gemini.google.com', label: 'Gemini' },
    { match: 'bard.google.com', label: 'Gemini' },
    { match: 'claude.ai', label: 'Claude' },
    { match: 'anthropic.com', label: 'Claude' },
    { match: 'copilot.microsoft.com', label: 'Copilot' },
    { match: 'bing.com/chat', label: 'Copilot' },
    { match: 'you.com', label: 'You.com' },
    { match: 'duckassist', label: 'DuckDuckGo AI' },
    { match: 'phind.com', label: 'Phind' },
    { match: 'poe.com', label: 'Poe' },
    { match: 'meta.ai', label: 'Meta AI' },
    { match: 'mistral.ai', label: 'Mistral' },
    { match: 'chat.mistral.ai', label: 'Mistral' },
    { match: 'grok.com', label: 'Grok' },
    { match: 'x.ai', label: 'Grok' },
    { match: 'deepseek.com', label: 'DeepSeek' },
    { match: 'kagi.com', label: 'Kagi' },
];

export interface SourceRow { name: string; value: number }

/** Which assistant, if any, a session source belongs to. */
export function aiReferrerLabel(source: string): string | null {
    const s = (source || '').toLowerCase();
    if (!s) return null;
    const hit = AI_REFERRERS.find(r => s.includes(r.match));
    return hit ? hit.label : null;
}

/**
 * Folds session-source rows into one row per assistant, summed and sorted
 * descending, with the percentage relative to the top row like every
 * other acquisition panel.
 */
export function bucketAiReferrers(rows: SourceRow[]): Array<SourceRow & { percentage: number }> {
    const totals = new Map<string, number>();
    for (const row of rows) {
        const label = aiReferrerLabel(row.name);
        if (!label) continue;
        totals.set(label, (totals.get(label) ?? 0) + (Number(row.value) || 0));
    }
    const items = [...totals].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const max = items[0]?.value || 1;
    return items.map(item => ({ ...item, percentage: Math.round((item.value / max) * 100) }));
}
