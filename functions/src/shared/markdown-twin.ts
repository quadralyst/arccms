/**
 * The Markdown twin of a published page (docs/discoverability-spec.md, D-D8):
 * the same content as the HTML, at a fraction of the tokens, at
 * `/{lang}/{type}/{slug}.md`. Advertised from the HTML head with
 * `<link rel="alternate" type="text/markdown">` and concatenated into
 * /llms-full.txt (D-D7).
 */
import { htmlToMarkdown } from './html-to-markdown.js';
import { langPrefix } from './content-translation.js';

export interface MarkdownTwinInput {
    title: string;
    /** Absolute canonical URL of the HTML page. */
    url: string;
    siteName?: string;
    authorName?: string;
    /** ISO 8601. */
    datePublished?: string;
    /** ISO 8601; printed only when it differs from datePublished. */
    dateModified?: string;
    summary?: string;
    tags?: string[];
    lang?: string;
    /** The body HTML as edited. */
    bodyHtml: string;
    /** Cited sources (D-D11), appended as a Sources list. */
    references?: { title?: string; url: string }[];
}

/** Hosting path of the twin; sits beside the `.html` file. */
export function markdownFilePath(lang: string, defaultLang: string, contentTypeSlug: string, urlSlug: string): string {
    return `${langPrefix(lang, defaultLang)}/${contentTypeSlug}/${urlSlug}.md`;
}

/** Absolute URL of the twin, for the `<link rel="alternate">` and llms.txt. */
export function markdownUrl(baseUrl: string, lang: string, defaultLang: string, contentTypeSlug: string, urlSlug: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${markdownFilePath(lang, defaultLang, contentTypeSlug, urlSlug)}`;
}

/**
 * Front matter first, so an agent reading only the top gets the facts, then
 * the body. Front matter keys are the schema.org names the HTML uses, to
 * keep the two representations obviously the same document.
 */
export function buildMarkdownTwin(input: MarkdownTwinInput): string {
    const lines: string[] = ['---'];
    lines.push(`title: ${yamlString(input.title)}`);
    lines.push(`url: ${yamlString(input.url)}`);
    if (input.siteName) lines.push(`site: ${yamlString(input.siteName)}`);
    if (input.authorName) lines.push(`author: ${yamlString(input.authorName)}`);
    if (input.datePublished) lines.push(`datePublished: ${input.datePublished.slice(0, 10)}`);
    if (input.dateModified && input.dateModified !== input.datePublished) {
        lines.push(`dateModified: ${input.dateModified.slice(0, 10)}`);
    }
    if (input.lang) lines.push(`lang: ${input.lang}`);
    const tags = (input.tags || []).map(t => t.trim()).filter(Boolean);
    if (tags.length) lines.push(`tags: [${tags.map(yamlString).join(', ')}]`);
    if (input.summary) lines.push(`description: ${yamlString(input.summary)}`);
    lines.push('---', '');

    lines.push(`# ${input.title.trim()}`, '');
    if (input.summary) lines.push(`> ${input.summary.trim()}`, '');
    const body = htmlToMarkdown(input.bodyHtml);
    if (body) lines.push(body.trimEnd(), '');
    const references = (input.references || []).filter(r => r.url);
    if (references.length) {
        lines.push('## Sources', '');
        for (const ref of references) lines.push(`- [${(ref.title || ref.url).trim()}](${ref.url.trim()})`);
        lines.push('');
    }
    lines.push(`Source: ${input.url}`, '');
    return lines.join('\n');
}

function yamlString(value: string): string {
    return JSON.stringify((value || '').trim());
}
