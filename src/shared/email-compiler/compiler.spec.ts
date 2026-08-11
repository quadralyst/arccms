import { describe, it, expect } from 'vitest';
import {
    compileEmailDesign,
    renderBlocks,
    compiledHtmlHasUnsubscribe,
    extractMergeTags,
    escapeHtml,
    escapeUrl,
} from './compiler';
import { EmailDesign, DEFAULT_BRAND_KIT, IEmailBrandKit } from './email-design.model';

function design(...blocks: any[]): EmailDesign {
    return { blocks };
}

describe('email compiler', () => {
    describe('escaping', () => {
        it('escapes HTML special chars', () => {
            expect(escapeHtml('<b>&"')).toBe('&lt;b&gt;&amp;&quot;');
        });
        it('keeps merge-tag-only hrefs intact', () => {
            expect(escapeUrl('##UNSUBSCRIBE_LINK##')).toBe('##UNSUBSCRIBE_LINK##');
        });
        it('escapes quotes/spaces in normal urls', () => {
            expect(escapeUrl('https://x.com/a b')).toBe('https://x.com/a%20b');
        });
    });

    describe('per-block rendering', () => {
        it('heading → <h1> with brand color and text', () => {
            const html = renderBlocks(design({ id: '1', type: 'heading', text: 'Hello', level: 1 }), DEFAULT_BRAND_KIT);
            expect(html).toContain('<h1');
            expect(html).toContain('Hello');
            expect(html).toContain(DEFAULT_BRAND_KIT.textColor);
        });

        it('paragraph preserves inline html', () => {
            const html = renderBlocks(design({ id: '1', type: 'paragraph', html: 'Hi <strong>there</strong>' }), DEFAULT_BRAND_KIT);
            expect(html).toContain('<strong>there</strong>');
        });

        it('image → img with alt + width, wrapped in link when href set', () => {
            const html = renderBlocks(design({ id: '1', type: 'image', src: 'https://x/y.png', alt: 'Logo', href: 'https://x' }), DEFAULT_BRAND_KIT);
            expect(html).toContain('<img');
            expect(html).toContain('alt="Logo"');
            expect(html).toContain('<a href="https://x"');
        });

        it('button → bulletproof table using the brand primary color', () => {
            const brand: IEmailBrandKit = { ...DEFAULT_BRAND_KIT, primaryColor: '#ff0000' };
            const html = renderBlocks(design({ id: '1', type: 'button', text: 'Click', href: 'https://x' }), brand);
            expect(html).toContain('bgcolor="#ff0000"');
            expect(html).toContain('Click');
            expect(html).toContain('href="https://x"');
        });

        it('divider → hr-like row', () => {
            const html = renderBlocks(design({ id: '1', type: 'divider' }), DEFAULT_BRAND_KIT);
            expect(html).toContain('border-top:1px solid');
        });

        it('spacer honors height', () => {
            const html = renderBlocks(design({ id: '1', type: 'spacer', height: 40 }), DEFAULT_BRAND_KIT);
            expect(html).toContain('height:40px');
        });

        it('social row renders brand social links (label text, no remote images)', () => {
            const brand: IEmailBrandKit = { ...DEFAULT_BRAND_KIT, socialLinks: [{ platform: 'x', url: 'https://x.com/acme' }] };
            const html = renderBlocks(design({ id: '1', type: 'social' }), brand);
            expect(html).toContain('https://x.com/acme');
            expect(html).toContain('>X<');
        });

        it('raw block passes html through untouched', () => {
            const html = renderBlocks(design({ id: '1', type: 'raw', html: '<div class="custom">x</div>' }), DEFAULT_BRAND_KIT);
            expect(html).toContain('<div class="custom">x</div>');
        });

        it('columns render both sides', () => {
            const html = renderBlocks(
                design({
                    id: '1',
                    type: 'columns',
                    left: [{ id: 'a', type: 'heading', text: 'L' }],
                    right: [{ id: 'b', type: 'heading', text: 'R' }],
                }),
                DEFAULT_BRAND_KIT,
            );
            expect(html).toContain('>L</h1>');
            expect(html).toContain('>R</h1>');
            expect(html).toContain('width="50%"');
        });
    });

    describe('full document', () => {
        it('wraps content in a 600px branded shell with the footer', () => {
            const html = compileEmailDesign(design({ id: '1', type: 'heading', text: 'Hi' }));
            expect(html).toContain('width="600"');
            expect(html).toContain(DEFAULT_BRAND_KIT.backgroundColor);
            expect(html).toContain('##UNSUBSCRIBE_LINK##');
            expect(html).toContain('##PREFERENCES_LINK##');
        });

        it('renders the logo header when logoUrl is set', () => {
            const html = compileEmailDesign(design(), { logoUrl: 'https://x/logo.png', logoWidth: 120 });
            expect(html).toContain('src="https://x/logo.png"');
            expect(html).toContain('width="120"');
        });

        it('a brand primary-color change flows into button previews without editing the design', () => {
            const d = design({ id: '1', type: 'button', text: 'Go', href: 'https://x' });
            const red = compileEmailDesign(d, { primaryColor: '#e11d48' });
            const green = compileEmailDesign(d, { primaryColor: '#16a34a' });
            expect(red).toContain('#e11d48');
            expect(green).toContain('#16a34a');
        });
    });

    describe('merge tags', () => {
        it('survive compilation (round-trip)', () => {
            const html = compileEmailDesign(design({ id: '1', type: 'paragraph', html: 'Hi ##NAME##, code ##OTP##' }));
            expect(html).toContain('##NAME##');
            expect(html).toContain('##OTP##');
        });

        it('extractMergeTags lists tags used in the design', () => {
            const tags = extractMergeTags(design({ id: '1', type: 'paragraph', html: '##NAME## ##PAYMENT_AMOUNT##' }));
            expect(tags.sort()).toEqual(['NAME', 'PAYMENT_AMOUNT']);
        });
    });

    describe('marketing unsubscribe guard', () => {
        it('default compiled output contains the unsubscribe tag', () => {
            const html = compileEmailDesign(design({ id: '1', type: 'heading', text: 'Sale' }));
            expect(compiledHtmlHasUnsubscribe(html)).toBe(true);
        });

        it('detects a footer stripped of the unsubscribe tag', () => {
            const html = compileEmailDesign(design({ id: '1', type: 'heading', text: 'Sale' }), {
                footerText: 'No unsubscribe here',
            });
            expect(compiledHtmlHasUnsubscribe(html)).toBe(false);
        });
    });
});
