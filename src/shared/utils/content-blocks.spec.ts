import { describe, it, expect } from 'vitest';
import { abstractFromTakeaways, blockJsonLd, extractBlocks, termFromQuestion } from './content-blocks';

const BODY = `<p>Intro</p>
<section data-arc-block="takeaways"><h3>Key takeaways</h3><ul><li>Fast</li><li>Free.</li></ul></section>
<section data-arc-block="faq"><h3>Cost?</h3><p>Nothing.</p><p>Ever.</p><h3>Licence?</h3><ul><li>MIT</li></ul></section>
<section data-arc-block="howto"><h3>How to start</h3><ol><li><strong>Install.</strong> Run it.</li><li>Publish.</li></ol></section>
<section data-arc-block="definition"><h3>What is Arc?</h3><p>Arc is a CMS.</p></section>`;

describe('content-blocks (client mirror, D-D10)', () => {
    it('reads every block kind the same way the server does', () => {
        const blocks = extractBlocks(BODY);
        expect(blocks.takeaways).toEqual(['Fast', 'Free.']);
        expect(blocks.faqs).toEqual([
            { question: 'Cost?', answer: 'Nothing. Ever.' },
            { question: 'Licence?', answer: 'MIT' },
        ]);
        expect(blocks.howTos).toEqual([{ name: 'How to start', steps: [{ name: 'Install', text: 'Install. Run it.' }, { text: 'Publish.' }] }]);
        expect(blocks.definitions).toEqual([{ term: 'Arc', description: 'Arc is a CMS.' }]);
    });

    it('finds the step name inside a wrapping paragraph', () => {
        const html = '<section data-arc-block="howto"><h3>How</h3><ol><li><p><strong>Install.</strong> Run it.</p></li></ol></section>';
        expect(extractBlocks(html).howTos[0].steps).toEqual([{ name: 'Install', text: 'Install. Run it.' }]);
    });

    it('returns empty shapes without blocks', () => {
        expect(extractBlocks('<p>plain</p>')).toEqual({ faqs: [], howTos: [], takeaways: [], definitions: [] });
        expect(extractBlocks('')).toEqual({ faqs: [], howTos: [], takeaways: [], definitions: [] });
    });

    it('builds the nodes in a stable order', () => {
        const nodes = blockJsonLd(extractBlocks(BODY), 'https://x.com/a');
        expect(nodes.map(n => n['@type'])).toEqual(['FAQPage', 'HowTo', 'DefinedTerm']);
        expect((nodes[1]['step'] as any[])[0]['url']).toBe('https://x.com/a#step-1');
    });

    it('helpers match the server', () => {
        expect(termFromQuestion('What are widgets?')).toBe('widgets');
        expect(abstractFromTakeaways(['Fast', 'Free.'])).toBe('Fast. Free.');
    });
});
