/**
 * The editor's discoverability checklist (docs/discoverability-spec.md, D-D13):
 * pure rules over a draft, scored, never blocking. Each rule says what it
 * checked and, when it fails, the one thing to do about it.
 *
 * The rules encode what gets a page ranked and quoted: an answer-first
 * opening, question-shaped headings, extractable structure, honest
 * freshness, a named author, cited sources and internal links.
 */

export interface ChecklistInput {
    title: string;
    /** Body HTML as edited. */
    bodyHtml: string;
    summary: string;
    metaDescription: string;
    coverImage: string | null;
    authorId: string | null;
    references: { url: string }[];
    tags: string[];
    publishedOn: unknown;
    updatedOn: unknown;
    /** Absolute origin of the site, to tell internal links from external ones. */
    siteOrigin: string;
}

export type ChecklistSeverity = 'high' | 'medium' | 'low';

export interface ChecklistResult {
    id: string;
    ok: boolean;
    severity: ChecklistSeverity;
    /** Translation key for the rule's name. */
    labelKey: string;
    /** Translation key for the fix, shown when the rule fails. */
    fixKey: string;
    /** Free-text detail (counts, lengths) for the row. */
    detail?: string;
}

export interface ChecklistReport {
    /** 0 to 100, weighted by severity. */
    score: number;
    passed: number;
    total: number;
    results: ChecklistResult[];
}

const WEIGHT: Record<ChecklistSeverity, number> = { high: 3, medium: 2, low: 1 };

/** Parses HTML in the browser; in a non-DOM host every rule that needs the body is skipped. */
function parse(html: string): Document | null {
    if (typeof DOMParser === 'undefined') return null;
    return new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
}

function wordCount(text: string): number {
    return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function evaluateDiscoverability(input: ChecklistInput): ChecklistReport {
    const doc = parse(input.bodyHtml);
    const results: ChecklistResult[] = [];
    const rule = (id: string, severity: ChecklistSeverity, ok: boolean, detail?: string) =>
        results.push({ id, ok, severity, labelKey: `admin.contents.checklist.${id}`, fixKey: `admin.contents.checklist.${id}_fix`, detail });

    // Title length: what Google shows and what an assistant quotes as the page name.
    const titleLength = (input.title || '').trim().length;
    rule('title_length', 'medium', titleLength > 0 && titleLength <= 70, titleLength ? `${titleLength}` : undefined);

    // Meta description: 50 to 160 characters.
    const metaLength = (input.metaDescription || '').trim().length;
    rule('meta_description', 'medium', metaLength >= 50 && metaLength <= 160, metaLength ? `${metaLength}` : undefined);

    if (doc) {
        const body = doc.body;
        const paragraphs = Array.from(body.querySelectorAll('p')).map(p => (p.textContent || '').trim()).filter(Boolean);
        const bodyText = (body.textContent || '').trim();

        // Answer first: the opening paragraph is a complete, quotable answer.
        const opening = paragraphs[0] || '';
        const openingWords = wordCount(opening);
        rule('answer_first', 'high', openingWords >= 15 && openingWords <= 70, openingWords ? `${openingWords}` : undefined);

        // Question headings: at least one heading phrased as the question people ask.
        const headings = Array.from(body.querySelectorAll('h2, h3, h4')).map(h => (h.textContent || '').trim());
        rule('question_heading', 'high', headings.some(h => /\?\s*$/.test(h)), headings.length ? `${headings.length}` : undefined);

        // Structure: a list or a table somewhere.
        rule('list_or_table', 'medium', !!body.querySelector('ul, ol, table'));

        // Blocks: FAQ or key takeaways present.
        rule('blocks', 'high', !!body.querySelector('section[data-arc-block="faq"], section[data-arc-block="takeaways"]'));

        // Internal links: three or more to this site.
        const origin = (input.siteOrigin || '').replace(/\/+$/, '').toLowerCase();
        const internal = Array.from(body.querySelectorAll('a[href]')).filter(a => {
            const href = (a.getAttribute('href') || '').trim().toLowerCase();
            if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
            if (href.startsWith('/')) return !href.startsWith('//');
            return !!origin && href.startsWith(origin);
        }).length;
        rule('internal_links', 'medium', internal >= 3, `${internal}`);

        // Length: enough to say something.
        const words = wordCount(bodyText);
        rule('length', 'low', words >= 300, `${words}`);
    }

    rule('cover_image', 'low', !!(input.coverImage || '').trim());
    rule('author', 'medium', !!(input.authorId || '').trim());
    rule('sources', 'medium', (input.references || []).some(r => /^https?:\/\//i.test((r.url || '').trim())));
    rule('tags', 'low', (input.tags || []).filter(Boolean).length >= 2, `${(input.tags || []).filter(Boolean).length}`);

    // Freshness: published or marked updated within the last twelve months.
    const latest = latestDate(input.updatedOn, input.publishedOn);
    const fresh = latest ? Date.now() - latest.getTime() < 365 * 24 * 60 * 60 * 1000 : true;
    rule('freshness', 'low', fresh, latest ? latest.toISOString().slice(0, 10) : undefined);

    const total = results.reduce((sum, r) => sum + WEIGHT[r.severity], 0);
    const earned = results.filter(r => r.ok).reduce((sum, r) => sum + WEIGHT[r.severity], 0);
    return {
        score: total ? Math.round((earned / total) * 100) : 0,
        passed: results.filter(r => r.ok).length,
        total: results.length,
        results,
    };
}

function toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'object' && value !== null && 'seconds' in value) return new Date(Number((value as { seconds: number }).seconds) * 1000);
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function latestDate(a: unknown, b: unknown): Date | null {
    const da = toDate(a);
    const db = toDate(b);
    if (da && db) return da > db ? da : db;
    return da || db;
}
