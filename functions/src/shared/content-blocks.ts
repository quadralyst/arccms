/**
 * Reads the structured blocks an author placed in the body
 * (docs/discoverability-spec.md, D-D10) and turns them into schema.org
 * nodes. The blocks are `<section data-arc-block="…">` wrappers around
 * ordinary headings, paragraphs and lists, so this is a shape reader, not
 * a parser of anything the editor invented:
 *
 *  - faq:        every h2/h3/h4 is a question; what follows it until the
 *                next heading is the answer.
 *  - howto:      the first heading is the name; the first ordered list's
 *                items are the steps (a leading <strong> is the step name).
 *  - takeaways:  the first list's items, joined, become Article.abstract.
 *  - definition: the first heading is the term ("What is X?" → X); the
 *                first paragraph is the definition.
 *
 * Mirrored client-side in src/shared/utils/content-blocks.ts for the SPA.
 */
import * as cheerio from 'cheerio';
import { SCHEMA_CONTEXT } from './structured-data.js';

export interface FaqEntry { question: string; answer: string }
export interface HowToStep { name?: string; text: string }
export interface HowToBlock { name: string; steps: HowToStep[] }
export interface DefinitionBlock { term: string; description: string }

export interface ContentBlocks {
    faqs: FaqEntry[];
    howTos: HowToBlock[];
    takeaways: string[];
    definitions: DefinitionBlock[];
}

const HEADINGS = 'h2, h3, h4';

export function extractBlocks(bodyHtml: string): ContentBlocks {
    const blocks: ContentBlocks = { faqs: [], howTos: [], takeaways: [], definitions: [] };
    if (!bodyHtml || !bodyHtml.includes('data-arc-block')) return blocks;

    const $ = cheerio.load(`<body>${bodyHtml}</body>`, { xmlMode: false });

    $('section[data-arc-block="faq"]').each((_, section) => {
        let question = '';
        let answer: string[] = [];
        const flush = () => {
            const a = clean(answer.join(' '));
            if (question && a) blocks.faqs.push({ question, answer: a });
            answer = [];
        };
        $(section).children().each((__, child) => {
            if ($(child).is(HEADINGS)) {
                flush();
                question = clean($(child).text());
            } else if (question) {
                answer.push(textWithBreaks($, child));
            }
        });
        flush();
    });

    $('section[data-arc-block="howto"]').each((_, section) => {
        const name = clean($(section).children(HEADINGS).first().text());
        const steps: HowToStep[] = [];
        $(section).find('ol').first().children('li').each((__, li) => {
            // Tiptap wraps list-item text in <p>, so the leading strong may be a grandchild.
            let strong = $(li).children('strong, b').first();
            if (!strong.length) strong = $(li).children('p').first().children('strong, b').first();
            const stepName = clean(strong.text()).replace(/[.:]$/, '');
            const text = clean($(li).text());
            if (!text) return;
            steps.push(stepName && stepName !== text ? { name: stepName, text } : { text });
        });
        if (name && steps.length) blocks.howTos.push({ name, steps });
    });

    $('section[data-arc-block="takeaways"]').each((_, section) => {
        $(section).find('ul, ol').first().children('li').each((__, li) => {
            const text = clean($(li).text());
            if (text) blocks.takeaways.push(text);
        });
    });

    $('section[data-arc-block="definition"]').each((_, section) => {
        const heading = clean($(section).children(HEADINGS).first().text());
        const term = termFromQuestion(heading);
        const description = clean($(section).children('p').first().text());
        if (term && description) blocks.definitions.push({ term, description });
    });

    return blocks;
}

/** "What is a CMS?" → "a CMS"; "What are widgets" → "widgets"; anything else unchanged. */
export function termFromQuestion(heading: string): string {
    const m = heading.match(/^\s*what(?:'s|\s+is|\s+are)\s+(.+?)\s*\??\s*$/i);
    return clean(m ? m[1] : heading);
}

type JsonLd = Record<string, unknown>;

export function buildFaqPage(faqs: FaqEntry[]): JsonLd | null {
    if (!faqs.length) return null;
    return {
        '@context': SCHEMA_CONTEXT,
        '@type': 'FAQPage',
        mainEntity: faqs.map(f => ({
            '@type': 'Question',
            name: f.question,
            acceptedAnswer: { '@type': 'Answer', text: f.answer },
        })),
    };
}

export function buildHowTo(block: HowToBlock, pageUrl?: string): JsonLd | null {
    if (!block.name || !block.steps.length) return null;
    const node: JsonLd = {
        '@context': SCHEMA_CONTEXT,
        '@type': 'HowTo',
        name: block.name,
        step: block.steps.map((s, i) => {
            const step: JsonLd = { '@type': 'HowToStep', position: i + 1, text: s.text };
            if (s.name) step['name'] = s.name;
            if (pageUrl) step['url'] = `${pageUrl}#step-${i + 1}`;
            return step;
        }),
    };
    return node;
}

export function buildDefinedTerms(definitions: DefinitionBlock[]): JsonLd[] {
    return definitions.map(d => ({
        '@context': SCHEMA_CONTEXT,
        '@type': 'DefinedTerm',
        name: d.term,
        description: d.description,
    }));
}

/** The Article.abstract text: the takeaways as one short paragraph. */
export function abstractFromTakeaways(takeaways: string[]): string | undefined {
    const items = takeaways.map(clean).filter(Boolean);
    if (!items.length) return undefined;
    return items.map(t => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ');
}

/** Every block-derived node for a page, in a stable order. */
export function blockJsonLd(blocks: ContentBlocks, pageUrl?: string): JsonLd[] {
    return [
        buildFaqPage(blocks.faqs),
        ...blocks.howTos.map(h => buildHowTo(h, pageUrl)),
        ...buildDefinedTerms(blocks.definitions),
    ].filter((n): n is JsonLd => !!n);
}

function clean(text: string): string {
    return (text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Text of an element with list items and paragraphs separated so an answer reads as prose. */
function textWithBreaks($: cheerio.CheerioAPI, el: unknown): string {
    const node = $(el as never);
    if (node.is('ul, ol')) {
        return node.children('li').toArray().map(li => clean($(li).text())).filter(Boolean).join(' ');
    }
    return clean(node.text());
}
