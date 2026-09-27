/**
 * The AI-related crawlers a site owner can allow or deny in robots.txt
 * (docs/discoverability-spec.md, D-D6).
 *
 * Two groups with different consequences:
 *  - `search`: bots that fetch pages to answer a question right now and cite
 *    the source. Denying them removes the site from those answers.
 *  - `training`: bots that collect pages for model training. Denying them
 *    has no effect on citations today; it is a policy choice.
 *
 * Mirrored client-side in src/shared/constants/crawlers.ts; a parity test
 * keeps the two lists identical. Add agents here (and there) as they appear;
 * a site's stored choices are keyed by `id`, so unknown ids are ignored and
 * new agents get the group default.
 */

export type CrawlerGroup = 'search' | 'training';

export interface CrawlerAgent {
    /** Stable key the setting is stored under. */
    id: string;
    /** Exact User-agent token for robots.txt. */
    userAgent: string;
    vendor: string;
    group: CrawlerGroup;
    /** One line on what allowing this bot gets the site. */
    description: string;
}

export const CRAWLERS: readonly CrawlerAgent[] = [
    // Search and answer bots: allow these to be cited.
    { id: 'oai-searchbot', userAgent: 'OAI-SearchBot', vendor: 'OpenAI', group: 'search', description: 'Fetches pages for ChatGPT search results and citations.' },
    { id: 'chatgpt-user', userAgent: 'ChatGPT-User', vendor: 'OpenAI', group: 'search', description: 'Fetches a page when a ChatGPT user asks about it.' },
    { id: 'claude-searchbot', userAgent: 'Claude-SearchBot', vendor: 'Anthropic', group: 'search', description: 'Indexes pages so Claude can cite them in answers.' },
    { id: 'claude-user', userAgent: 'Claude-User', vendor: 'Anthropic', group: 'search', description: 'Fetches a page when a Claude user asks about it.' },
    { id: 'perplexitybot', userAgent: 'PerplexityBot', vendor: 'Perplexity', group: 'search', description: 'Indexes pages for Perplexity answers and citations.' },
    { id: 'perplexity-user', userAgent: 'Perplexity-User', vendor: 'Perplexity', group: 'search', description: 'Fetches a page when a Perplexity user asks about it.' },
    { id: 'bingbot', userAgent: 'Bingbot', vendor: 'Microsoft', group: 'search', description: 'Bing search, which also powers ChatGPT search and Copilot.' },
    { id: 'googlebot', userAgent: 'Googlebot', vendor: 'Google', group: 'search', description: 'Google Search and AI Overviews.' },
    { id: 'duckassistbot', userAgent: 'DuckAssistBot', vendor: 'DuckDuckGo', group: 'search', description: 'DuckDuckGo AI answers.' },

    // Training bots: a policy choice with no effect on citations today.
    { id: 'gptbot', userAgent: 'GPTBot', vendor: 'OpenAI', group: 'training', description: 'Collects pages to train OpenAI models.' },
    { id: 'claudebot', userAgent: 'ClaudeBot', vendor: 'Anthropic', group: 'training', description: 'Collects pages to train Anthropic models.' },
    { id: 'google-extended', userAgent: 'Google-Extended', vendor: 'Google', group: 'training', description: 'Opts pages out of Gemini training without affecting Google Search.' },
    { id: 'applebot-extended', userAgent: 'Applebot-Extended', vendor: 'Apple', group: 'training', description: 'Opts pages out of Apple model training without affecting Siri and Spotlight.' },
    { id: 'ccbot', userAgent: 'CCBot', vendor: 'Common Crawl', group: 'training', description: 'The open crawl most model builders train from.' },
    { id: 'meta-externalagent', userAgent: 'meta-externalagent', vendor: 'Meta', group: 'training', description: 'Collects pages to train Meta models.' },
    { id: 'bytespider', userAgent: 'Bytespider', vendor: 'ByteDance', group: 'training', description: 'Collects pages for ByteDance models.' },
    { id: 'amazonbot', userAgent: 'Amazonbot', vendor: 'Amazon', group: 'training', description: 'Collects pages for Alexa and Amazon models.' },
];

/** Every agent allowed unless the owner says otherwise (D-D6). */
export const DEFAULT_CRAWLER_POLICY: Record<string, boolean> = Object.fromEntries(
    CRAWLERS.map(agent => [agent.id, true]),
);
