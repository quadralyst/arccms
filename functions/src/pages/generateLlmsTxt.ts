import { db } from '../init.js';
import { getSiteConfig, getAboutConfig, getLocalizationSettings } from '../shared/site-settings.js';
import { getDiscoverabilitySettings } from '../shared/discoverability-settings.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { contentTypeDescription, contentTypeName } from '../shared/content-type-names.js';
import { detailUrl, listUrl } from '../shared/content-translation.js';
import { resolveContentDates } from '../shared/content-dates.js';
import { buildMarkdownTwin, markdownUrl } from '../shared/markdown-twin.js';
import { deploySeoFileToHosting } from './deploySeoFile.js';
import { HostingBatch } from './deployToHosting.js';

/** llms.txt lists at most this many pages, newest first (D-D7). */
export const LLMS_TXT_MAX_LINKS = 500;
/** llms-full.txt stops appending pages once it would pass this size. */
export const LLMS_FULL_MAX_BYTES = 2 * 1024 * 1024;

export interface LlmsPage {
    title: string;
    url: string;
    markdownUrl: string;
    summary: string;
    /** Sort key, newest first. */
    sortAt: number;
    markdown: string;
}

export interface LlmsSection {
    name: string;
    description: string;
    listUrl: string;
    pages: LlmsPage[];
}

export interface LlmsSiteInput {
    siteName: string;
    baseUrl: string;
    description: string;
    sections: LlmsSection[];
}

/**
 * The llms.txt convention (llmstxt.org): an H1, a blockquote summary, then
 * H2 sections of `- [title](url): description` links. Markdown twins are
 * linked, not the HTML, because that is the form an agent wants. Pure.
 */
export function renderLlmsTxt(input: LlmsSiteInput): string {
    const lines: string[] = [`# ${input.siteName.trim() || input.baseUrl}`, ''];
    if (input.description.trim()) lines.push(`> ${input.description.trim()}`, '');
    lines.push(
        `Each page below links to a Markdown version of the same content. The HTML page is at the same path without \`.md\`.`,
        '',
    );

    let remaining = LLMS_TXT_MAX_LINKS;
    for (const section of input.sections) {
        if (!section.pages.length || remaining <= 0) continue;
        lines.push(`## ${section.name.trim()}`, '');
        if (section.description.trim()) lines.push(section.description.trim(), '');
        const pages = [...section.pages].sort((a, b) => b.sortAt - a.sortAt).slice(0, remaining);
        remaining -= pages.length;
        for (const page of pages) {
            const summary = page.summary.trim().replace(/\s+/g, ' ');
            lines.push(`- [${page.title.trim()}](${page.markdownUrl})${summary ? `: ${summary}` : ''}`);
        }
        lines.push('');
    }
    lines.push('## Optional', '', `- [Sitemap](${input.baseUrl.replace(/\/+$/, '')}/sitemap.xml)`, '');
    return lines.join('\n');
}

/** Every Markdown twin, newest first, concatenated until the size cap. Pure. */
export function renderLlmsFullTxt(input: LlmsSiteInput): string {
    const header = `# ${input.siteName.trim() || input.baseUrl}\n\n${input.description.trim() ? `> ${input.description.trim()}\n\n` : ''}`;
    const parts: string[] = [header];
    let bytes = Buffer.byteLength(header, 'utf8');
    const pages = input.sections.flatMap(s => s.pages).sort((a, b) => b.sortAt - a.sortAt);
    for (const page of pages) {
        const chunk = `\n---\n\n${page.markdown.trimEnd()}\n`;
        const size = Buffer.byteLength(chunk, 'utf8');
        if (bytes + size > LLMS_FULL_MAX_BYTES) break;
        parts.push(chunk);
        bytes += size;
    }
    return parts.join('');
}

/**
 * Reads every public content type and its published items in the default
 * language and shapes them for the two renderers.
 */
export async function collectLlmsSite(): Promise<LlmsSiteInput> {
    const [siteConfig, about, localization] = await Promise.all([
        getSiteConfig(),
        getAboutConfig(),
        getLocalizationSettings(),
    ]);
    const baseUrl = siteConfig.baseUrl.replace(/\/+$/, '');
    const lang = localization.defaultLanguage;

    const typesSnap = await db.collection('ContentTypes').get();
    const types = typesSnap.docs
        .map(doc => doc.data() as Record<string, any>)
        .filter(ct => ct.slug && ct.hasPublicUrl !== false);

    const sections: LlmsSection[] = [];
    for (const type of types) {
        const contentsSnap = await db
            .collection(getPublishedCollectionName(type.slug))
            .orderBy('publishedOn', 'desc')
            .get();
        const pages: LlmsPage[] = [];
        for (const doc of contentsSnap.docs) {
            const data = doc.data() as Record<string, any>;
            if (!data.urlSlug || !data.title) continue;
            const dates = resolveContentDates(data);
            const url = detailUrl(baseUrl, lang, lang, type.slug, data.urlSlug);
            pages.push({
                title: data.title,
                url,
                markdownUrl: markdownUrl(baseUrl, lang, lang, type.slug, data.urlSlug),
                summary: data.summary || data.metaDescription || '',
                sortAt: dates.published ? Date.parse(dates.published) : 0,
                markdown: buildMarkdownTwin({
                    title: data.title,
                    url,
                    siteName: siteConfig.siteName,
                    authorName: data.authorName || '',
                    datePublished: dates.published,
                    dateModified: dates.modified,
                    summary: data.summary || data.metaDescription || '',
                    tags: data.tags || [],
                    lang,
                    bodyHtml: data.content || '',
                }),
            });
        }
        sections.push({
            name: contentTypeName(type as any, lang),
            description: contentTypeDescription(type as any, lang),
            listUrl: listUrl(baseUrl, lang, lang, type.slug),
            pages,
        });
    }

    return {
        siteName: siteConfig.siteName,
        baseUrl,
        description: about.description,
        sections,
    };
}

/**
 * Deploys /llms.txt and /llms-full.txt, or removes them when the owner
 * switched the feature off. With a batch the files ride in the caller's
 * release.
 */
export async function generateAndDeployLlmsTxt(batch?: HostingBatch): Promise<void> {
    const settings = await getDiscoverabilitySettings();
    if (!settings.llmsTxt) {
        // Removal only makes sense inside a release that knows the current
        // files; a standalone call has nothing to remove from.
        if (batch) {
            batch.remove('/llms.txt');
            batch.remove('/llms-full.txt');
        }
        return;
    }
    const site = await collectLlmsSite();
    await deploySeoFileToHosting('/llms.txt', renderLlmsTxt(site), batch);
    await deploySeoFileToHosting('/llms-full.txt', renderLlmsFullTxt(site), batch);
}
