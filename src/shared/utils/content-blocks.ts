/**
 * Client mirror of functions/src/shared/content-blocks.ts for the SPA
 * fallback pages (docs/discoverability-spec.md, D-D10): reads the
 * `<section data-arc-block="…">` wrappers out of a body and builds the
 * matching schema.org nodes. Uses DOMParser, so browser only; on the server
 * it returns empty shapes and the static pages carry the real nodes anyway.
 */
import { SCHEMA_CONTEXT, JsonLd } from './structured-data';

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

const EMPTY: ContentBlocks = { faqs: [], howTos: [], takeaways: [], definitions: [] };
const HEADINGS = 'H2,H3,H4';

export function extractBlocks(bodyHtml: string): ContentBlocks {
    if (!bodyHtml || !bodyHtml.includes('data-arc-block') || typeof DOMParser === 'undefined') {
        return { faqs: [], howTos: [], takeaways: [], definitions: [] };
    }
    const doc = new DOMParser().parseFromString(`<body>${bodyHtml}</body>`, 'text/html');
    const blocks: ContentBlocks = { faqs: [], howTos: [], takeaways: [], definitions: [] };
    const isHeading = (el: Element) => HEADINGS.split(',').includes(el.tagName);

    doc.querySelectorAll('section[data-arc-block="faq"]').forEach(section => {
        let question = '';
        let answer: string[] = [];
        const flush = () => {
            const a = clean(answer.join(' '));
            if (question && a) blocks.faqs.push({ question, answer: a });
            answer = [];
        };
        Array.from(section.children).forEach(child => {
            if (isHeading(child)) {
                flush();
                question = clean(child.textContent || '');
            } else if (question) {
                answer.push(textWithBreaks(child));
            }
        });
        flush();
    });

    doc.querySelectorAll('section[data-arc-block="howto"]').forEach(section => {
        const heading = Array.from(section.children).find(isHeading);
        const name = clean(heading?.textContent || '');
        const steps: HowToStep[] = [];
        section.querySelector('ol')?.querySelectorAll(':scope > li').forEach(li => {
            // Tiptap wraps list-item text in <p>, so the leading strong may be a grandchild.
            const isStrong = (c: Element) => c.tagName === 'STRONG' || c.tagName === 'B';
            const strong = Array.from(li.children).find(isStrong)
                ?? Array.from(li.querySelector(':scope > p')?.children ?? []).find(isStrong);
            const stepName = clean(strong?.textContent || '').replace(/[.:]$/, '');
            const text = clean(li.textContent || '');
            if (!text) return;
            steps.push(stepName && stepName !== text ? { name: stepName, text } : { text });
        });
        if (name && steps.length) blocks.howTos.push({ name, steps });
    });

    doc.querySelectorAll('section[data-arc-block="takeaways"]').forEach(section => {
        section.querySelector('ul, ol')?.querySelectorAll(':scope > li').forEach(li => {
            const text = clean(li.textContent || '');
            if (text) blocks.takeaways.push(text);
        });
    });

    doc.querySelectorAll('section[data-arc-block="definition"]').forEach(section => {
        const heading = Array.from(section.children).find(isHeading);
        const term = termFromQuestion(clean(heading?.textContent || ''));
        const p = Array.from(section.children).find(c => c.tagName === 'P');
        const description = clean(p?.textContent || '');
        if (term && description) blocks.definitions.push({ term, description });
    });

    return blocks;
}

export function termFromQuestion(heading: string): string {
    const m = heading.match(/^\s*what(?:'s|\s+is|\s+are)\s+(.+?)\s*\??\s*$/i);
    return clean(m ? m[1] : heading);
}

export function abstractFromTakeaways(takeaways: string[]): string | undefined {
    const items = takeaways.map(clean).filter(Boolean);
    if (!items.length) return undefined;
    return items.map(t => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ');
}

export function blockJsonLd(blocks: ContentBlocks, pageUrl?: string): JsonLd[] {
    const nodes: JsonLd[] = [];
    if (blocks.faqs.length) {
        nodes.push({
            '@context': SCHEMA_CONTEXT,
            '@type': 'FAQPage',
            mainEntity: blocks.faqs.map(f => ({
                '@type': 'Question',
                name: f.question,
                acceptedAnswer: { '@type': 'Answer', text: f.answer },
            })),
        });
    }
    for (const h of blocks.howTos) {
        nodes.push({
            '@context': SCHEMA_CONTEXT,
            '@type': 'HowTo',
            name: h.name,
            step: h.steps.map((s, i) => {
                const step: JsonLd = { '@type': 'HowToStep', position: i + 1, text: s.text };
                if (s.name) step['name'] = s.name;
                if (pageUrl) step['url'] = `${pageUrl}#step-${i + 1}`;
                return step;
            }),
        });
    }
    for (const d of blocks.definitions) {
        nodes.push({ '@context': SCHEMA_CONTEXT, '@type': 'DefinedTerm', name: d.term, description: d.description });
    }
    return nodes;
}

export const EMPTY_BLOCKS = EMPTY;

function clean(text: string): string {
    return (text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function textWithBreaks(el: Element): string {
    if (el.tagName === 'UL' || el.tagName === 'OL') {
        return Array.from(el.querySelectorAll(':scope > li')).map(li => clean(li.textContent || '')).filter(Boolean).join(' ');
    }
    return clean(el.textContent || '');
}
