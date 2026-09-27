import { describe, it, expect } from 'vitest';
import {
    abstractFromTakeaways,
    blockJsonLd,
    buildFaqPage,
    buildHowTo,
    extractBlocks,
    termFromQuestion,
} from '../shared/content-blocks.js';

const FAQ = `<section data-arc-block="faq">
  <h3>What does it cost?</h3><p>It is free.</p><p>Forever.</p>
  <h3>Is it open source?</h3><ul><li>Yes</li><li>MIT licence</li></ul>
  <h3>Unanswered?</h3>
</section>`;

const HOWTO = `<section data-arc-block="howto">
  <h3>How to publish</h3>
  <ol><li><strong>Write.</strong> Draft the article.</li><li>Press Publish.</li><li> </li></ol>
</section>`;

const TAKEAWAYS = `<section data-arc-block="takeaways"><h3>Key takeaways</h3><ul><li>Fast</li><li>Free.</li><li></li></ul></section>`;

const DEFINITION = `<section data-arc-block="definition"><h3>What is a headless CMS?</h3><p>A headless CMS stores content without a front end.</p><p>More.</p></section>`;

describe('extractBlocks (docs/discoverability-spec.md, D-D10)', () => {
    it('returns empty shapes for plain content and for no content', () => {
        expect(extractBlocks('')).toEqual({ faqs: [], howTos: [], takeaways: [], definitions: [] });
        expect(extractBlocks('<h3>Question?</h3><p>Not in a block.</p>').faqs).toEqual([]);
    });

    it('reads FAQ pairs: each heading a question, following content the answer, lists flattened', () => {
        expect(extractBlocks(FAQ).faqs).toEqual([
            { question: 'What does it cost?', answer: 'It is free. Forever.' },
            { question: 'Is it open source?', answer: 'Yes MIT licence' },
        ]);
    });

    it('reads how-to name and steps, with a leading strong as the step name', () => {
        expect(extractBlocks(HOWTO).howTos).toEqual([{
            name: 'How to publish',
            steps: [
                { name: 'Write', text: 'Write. Draft the article.' },
                { text: 'Press Publish.' },
            ],
        }]);
    });

    it('finds the step name when the editor wrapped the item text in a paragraph', () => {
        const html = '<section data-arc-block="howto"><h3>How</h3><ol><li><p><strong>Install.</strong> Run it.</p></li></ol></section>';
        expect(extractBlocks(html).howTos[0].steps).toEqual([{ name: 'Install', text: 'Install. Run it.' }]);
    });

    it('reads takeaways and definitions', () => {
        expect(extractBlocks(TAKEAWAYS).takeaways).toEqual(['Fast', 'Free.']);
        expect(extractBlocks(DEFINITION).definitions).toEqual([
            { term: 'a headless CMS', description: 'A headless CMS stores content without a front end.' },
        ]);
    });

    it('reads several blocks of different kinds from one body', () => {
        const blocks = extractBlocks(`<p>Intro</p>${TAKEAWAYS}<p>Body</p>${FAQ}${HOWTO}${DEFINITION}`);
        expect(blocks.faqs.length).toBe(2);
        expect(blocks.howTos.length).toBe(1);
        expect(blocks.takeaways.length).toBe(2);
        expect(blocks.definitions.length).toBe(1);
    });
});

describe('termFromQuestion', () => {
    it('strips the question frame', () => {
        expect(termFromQuestion('What is a CMS?')).toBe('a CMS');
        expect(termFromQuestion("What's IndexNow")).toBe('IndexNow');
        expect(termFromQuestion('What are widgets ?')).toBe('widgets');
        expect(termFromQuestion('Definition of X')).toBe('Definition of X');
    });
});

describe('block JSON-LD builders', () => {
    it('FAQPage nests Question and Answer', () => {
        const node = buildFaqPage([{ question: 'Q?', answer: 'A.' }])!;
        expect(node['@type']).toBe('FAQPage');
        expect(node['mainEntity']).toEqual([{ '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'A.' } }]);
        expect(buildFaqPage([])).toBeNull();
    });

    it('HowTo numbers steps and anchors them to the page', () => {
        const node = buildHowTo({ name: 'How', steps: [{ name: 'One', text: 'One. Do it.' }, { text: 'Two.' }] }, 'https://x.com/a')!;
        expect(node['step']).toEqual([
            { '@type': 'HowToStep', position: 1, text: 'One. Do it.', name: 'One', url: 'https://x.com/a#step-1' },
            { '@type': 'HowToStep', position: 2, text: 'Two.', url: 'https://x.com/a#step-2' },
        ]);
        expect(buildHowTo({ name: '', steps: [{ text: 'x' }] })).toBeNull();
    });

    it('abstract joins takeaways into sentences', () => {
        expect(abstractFromTakeaways(['Fast', 'Free.', ''])).toBe('Fast. Free.');
        expect(abstractFromTakeaways([])).toBeUndefined();
    });

    it('blockJsonLd returns every node in a stable order', () => {
        const nodes = blockJsonLd(extractBlocks(`${FAQ}${HOWTO}${DEFINITION}`), 'https://x.com/a');
        expect(nodes.map(n => n['@type'])).toEqual(['FAQPage', 'HowTo', 'DefinedTerm']);
        expect(blockJsonLd(extractBlocks(''))).toEqual([]);
    });
});
