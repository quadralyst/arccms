/**
 * The data of one card in a list or partial (functions/src/shared/content-cards.ts).
 */
import { describe, expect, it } from 'vitest';
import { cardData } from '../shared/content-cards.js';
import { TemplateHydrationService } from '../shared/template-hydration.js';

const ITEM = {
    id: 'a1', title: 'First post', urlSlug: 'first-post', authorName: 'Asha',
    metaDescription: 'A short description.', tags: ['yoga'],
    customFields: { 'articles-hero-image': 'https://cdn.test/hero.jpg', 'articles-reading-level': 'Easy' },
};

describe('cardData', () => {
    it('builds the card in the page\'s language', () => {
        const card = cardData(ITEM, 'articles', 'लेख', 'hi', '/hi');
        expect(card).toMatchObject({ url: '/hi/articles/first-post', authorName: 'Asha', contentType: 'लेख', contentTypeSlug: 'articles', tagsDisplay: 'yoga' });
        // Ready to show: no loading shimmer class, which the app would show as blank text.
        expect(card.tagsHtml).toContain('class="tag-pill"');
        expect(card.tagsHtml).not.toContain('arc-skeleton');
    });

    it('lets a custom field answer to its short key in a loop, as on the detail page', () => {
        const card = cardData(ITEM, 'articles', 'Articles', 'en', '');
        const html = TemplateHydrationService.processLoops(
            '<div data-arc-loop="items"><article><p class="level">{{ reading-level }}</p><p class="full">{{ articles-reading-level }}</p><span data-arc-if="hero-image">hero</span></article></div>',
            { items: [card] },
        );
        expect(html).toContain('<p class="level">Easy</p>');
        expect(html).toContain('<p class="full">Easy</p>');
        expect(html).toContain('<span>hero</span>');
    });
});
