import { describe, it, expect } from 'vitest';
import { TemplateHydrationService } from '../shared/template-hydration.js';

describe('TemplateHydrationService', () => {
    describe('hydrateTemplate', () => {
        it('should interpolate {{ variable }} with data values', () => {
            const html = '<h1>{{ title }}</h1>';
            const result = TemplateHydrationService.hydrateTemplate(html, { title: 'Hello World' });
            expect(result).toContain('Hello World');
            expect(result).not.toContain('{{');
        });

        it('should handle nested dot notation {{ share.twitter }}', () => {
            const html = '<a href="{{ share.twitter }}">Tweet</a>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                share: { twitter: 'https://twitter.com/intent/tweet?text=hi' },
            });
            expect(result).toContain('https://twitter.com/intent/tweet?text=hi');
        });

        it('should return empty string for missing variables', () => {
            const html = '<p>{{ missing }}</p>';
            const result = TemplateHydrationService.hydrateTemplate(html, { other: 'val' });
            expect(result).toContain('<p></p>');
        });

        it('should process data-arc-if — remove element when value is falsy', () => {
            const html = '<div data-arc-if="coverImage"><img src="test.jpg"></div><p>Keep</p>';
            const result = TemplateHydrationService.hydrateTemplate(html, { coverImage: '' });
            expect(result).not.toContain('<img');
            expect(result).toContain('<p>Keep</p>');
        });

        it('should process data-arc-if — keep element when value is truthy', () => {
            const html = '<div data-arc-if="coverImage"><img src="test.jpg"></div>';
            const result = TemplateHydrationService.hydrateTemplate(html, { coverImage: 'img.jpg' });
            expect(result).toContain('<img');
            expect(result).not.toContain('data-arc-if');
        });

        it('should process [innerHTML] — set element inner HTML', () => {
            const html = '<div [innerHTML]="content"></div>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                content: '<p>Rich content</p>',
            });
            expect(result).toContain('<p>Rich content</p>');
            expect(result).not.toContain('[innerHTML]');
        });

        it('should process [src] and [href] attribute bindings', () => {
            const html = '<img [src]="coverImage"><a [href]="url">Link</a>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                coverImage: '/img.jpg',
                url: '/page',
            });
            expect(result).toContain('src="/img.jpg"');
            expect(result).toContain('href="/page"');
            expect(result).not.toContain('[src]');
            expect(result).not.toContain('[href]');
        });

        it('should process data-arc-bind on <img> (sets src and alt)', () => {
            const html = '<img data-arc-bind="coverImage">';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                coverImage: '/photo.jpg',
                title: 'Photo Title',
            });
            expect(result).toContain('src="/photo.jpg"');
            expect(result).toContain('alt="Photo Title"');
            expect(result).not.toContain('data-arc-bind');
        });

        it('should process data-arc-bind on <a> (sets href)', () => {
            const html = '<a data-arc-bind="url">Click</a>';
            const result = TemplateHydrationService.hydrateTemplate(html, { url: '/target' });
            expect(result).toContain('href="/target"');
        });

        it('should process data-arc-bind on text elements — sets text for plain values', () => {
            const html = '<span data-arc-bind="author">Placeholder</span>';
            const result = TemplateHydrationService.hydrateTemplate(html, { author: 'John' });
            expect(result).toContain('John');
            expect(result).not.toContain('Placeholder');
        });

        it('should process data-arc-bind on text elements — sets HTML for values with tags', () => {
            const html = '<div data-arc-bind="body">Placeholder</div>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                body: '<p>Paragraph</p>',
            });
            expect(result).toContain('<p>Paragraph</p>');
        });

        it('should process data-arc-style-background', () => {
            const html = '<span data-arc-style-background="color">Tag</span>';
            const result = TemplateHydrationService.hydrateTemplate(html, { color: '#ff0000' });
            expect(result).toContain('background-color: #ff0000');
            expect(result).toContain('color: #333');
            expect(result).not.toContain('data-arc-style-background');
        });

        it('should flatten customFields._ref_* keys', () => {
            const html = '<span>{{ ref_author }}</span>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                customFields: { _ref_author: 'Jane Doe' },
            });
            expect(result).toContain('Jane Doe');
        });

        it('should remove arc-skeleton class after hydration of text nodes', () => {
            const html = '<h1 class="arc-skeleton">{{ title }}</h1>';
            const result = TemplateHydrationService.hydrateTemplate(html, { title: 'Real Title' });
            expect(result).toContain('Real Title');
            expect(result).not.toContain('arc-skeleton');
        });

        it('should remove arc-skeleton class after [innerHTML] hydration', () => {
            const html = '<div class="arc-skeleton" [innerHTML]="content"></div>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                content: '<p>Content</p>',
            });
            expect(result).not.toContain('arc-skeleton');
        });
    });

    describe('Icon Token Flattening', () => {
        const icon = {
            set: 'fa',
            name: 'magnifying-glass',
            style: 'solid',
            classes: 'fa-solid fa-magnifying-glass',
            label: 'Magnifying Glass',
            markup: '<svg viewBox="0 0 512 512" fill="currentColor"><path d="M416 208z"/></svg>',
        };

        it('should render the class list for the bare key', () => {
            const html = '<i class="card-icon {{ card_icon }}"></i>';
            const result = TemplateHydrationService.hydrateTemplate(html, { card_icon: icon });

            expect(result).toContain('class="card-icon fa-solid fa-magnifying-glass"');
            expect(result).not.toContain('[object Object]');
        });

        it('should expose the inline svg under a Svg suffix', () => {
            const html = '<span data-arc-bind="card_icon_svg"></span>';
            const result = TemplateHydrationService.hydrateTemplate(html, { card_icon: icon });

            expect(result).toContain('<svg viewBox="0 0 512 512"');
            expect(result).toContain('<path d="M416 208z"');
        });

        it('should expose the label and name for accessibility', () => {
            const html = '<i aria-label="{{ card_icon_label }}" data-name="{{ card_icon_name }}"></i>';
            const result = TemplateHydrationService.hydrateTemplate(html, { card_icon: icon });

            expect(result).toContain('aria-label="Magnifying Glass"');
            expect(result).toContain('data-name="magnifying-glass"');
        });

        it('should fall back to the name when the token has no label', () => {
            const html = '<i aria-label="{{ card_icon_label }}"></i>';
            const { label, ...unlabelled } = icon;
            const result = TemplateHydrationService.hydrateTemplate(html, { card_icon: unlabelled });

            expect(result).toContain('aria-label="magnifying-glass"');
        });

        it('should render an empty string when the token has no markup', () => {
            const html = '<span data-arc-bind="card_icon_svg">placeholder</span>';
            const { markup, ...noMarkup } = icon;
            const result = TemplateHydrationService.hydrateTemplate(html, { card_icon: noMarkup });

            expect(result).not.toContain('placeholder');
            expect(result).not.toContain('undefined');
        });

        it('should not mutate the caller data object', () => {
            const data: Record<string, any> = { card_icon: icon };
            const originalKeys = Object.keys(data).sort();

            TemplateHydrationService.hydrateTemplate('<i class="{{ card_icon }}"></i>', data);

            expect(Object.keys(data).sort()).toEqual(originalKeys);
            expect(data['card_icon']).toBe(icon);
        });

        it('should leave ordinary strings and objects alone', () => {
            const html = '<h1>{{ title }}</h1><span>{{ author.name }}</span>';
            const data = { title: 'Hello', author: { name: 'Jane' } };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('Hello');
            expect(result).toContain('Jane');
        });

        it('should flatten icons on each item of a loop', () => {
            const html = '<div data-arc-loop="cards"><i class="{{ icon }}"></i></div>';
            const result = TemplateHydrationService.processLoops(html, {
                cards: [
                    { icon: { ...icon, classes: 'fa-solid fa-star', name: 'star' } },
                    { icon: { ...icon, classes: 'fa-solid fa-heart', name: 'heart' } },
                ],
            });

            expect(result).toContain('class="fa-solid fa-star"');
            expect(result).toContain('class="fa-solid fa-heart"');
        });
    });

    describe('processLoops', () => {
        it('should expand loop with array of items using named loops', () => {
            const html = '<ul data-arc-loop="items"><li>{{ title }}</li></ul>';
            const result = TemplateHydrationService.processLoops(html, {
                items: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }],
            });
            expect(result).toContain('One');
            expect(result).toContain('Two');
            expect(result).toContain('Three');
        });

        it('should handle multiple named loops', () => {
            const html = `
                <div data-arc-loop="tags"><span>{{ name }}</span></div>
                <ul data-arc-loop="items"><li>{{ title }}</li></ul>
            `;
            const result = TemplateHydrationService.processLoops(html, {
                tags: [{ name: 'Tech' }, { name: 'Science' }],
                items: [{ title: 'Article 1' }],
            });
            expect(result).toContain('Tech');
            expect(result).toContain('Science');
            expect(result).toContain('Article 1');
        });

        it('should respect data-limit attribute', () => {
            const html = '<ul data-arc-loop="items" data-limit="2"><li>{{ title }}</li></ul>';
            const result = TemplateHydrationService.processLoops(html, {
                items: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }],
            });
            expect(result).toContain('One');
            expect(result).toContain('Two');
            expect(result).not.toContain('Three');
        });

        it('should empty container when data array is empty', () => {
            const html = '<ul data-arc-loop="items"><li>Template</li></ul>';
            const result = TemplateHydrationService.processLoops(html, { items: [] });
            expect(result).not.toContain('Template');
            expect(result).not.toContain('<li>');
        });

        it('should remove data-arc-loop and data-limit attributes after processing', () => {
            const html = '<ul data-arc-loop="items" data-limit="5"><li>{{ title }}</li></ul>';
            const result = TemplateHydrationService.processLoops(html, {
                items: [{ title: 'One' }],
            });
            expect(result).not.toContain('data-arc-loop');
            expect(result).not.toContain('data-limit');
        });

        it('should support single unnamed loop with array (backward compat)', () => {
            const html = '<ul data-arc-loop="items"><li>{{ title }}</li></ul>';
            const result = TemplateHydrationService.processLoops(html, [
                { title: 'Alpha' },
                { title: 'Beta' },
            ]);
            expect(result).toContain('Alpha');
            expect(result).toContain('Beta');
        });
    });

    describe('processTemplate', () => {
        it('should process loops first then single-value hydration', () => {
            const html = `
                <h1>{{ pageTitle }}</h1>
                <ul data-arc-loop="items"><li>{{ name }}</li></ul>
            `;
            const result = TemplateHydrationService.processTemplate(
                html,
                { pageTitle: 'My Page' },
                { items: [{ name: 'Item A' }, { name: 'Item B' }] },
            );
            expect(result).toContain('My Page');
            expect(result).toContain('Item A');
            expect(result).toContain('Item B');
        });

        it('should work with only single data (no loops)', () => {
            const html = '<h1>{{ title }}</h1>';
            const result = TemplateHydrationService.processTemplate(html, { title: 'Solo' });
            expect(result).toContain('Solo');
        });

        it('should work with only loop data (no single data)', () => {
            const html = '<ul data-arc-loop="items"><li>{{ val }}</li></ul>';
            const result = TemplateHydrationService.processTemplate(
                html,
                undefined,
                { items: [{ val: 'X' }] },
            );
            expect(result).toContain('X');
        });
    });

    describe('sanitizeHtml', () => {
        it('should strip script tags', () => {
            const html = '<p>Safe</p><script>alert("xss")</script>';
            const result = TemplateHydrationService.sanitizeHtml(html);
            expect(result).toContain('<p>Safe</p>');
            expect(result).not.toContain('<script>');
            expect(result).not.toContain('alert');
        });

        it('should strip inline event handlers', () => {
            const html = '<div onclick="evil()">Content</div>';
            const result = TemplateHydrationService.sanitizeHtml(html);
            expect(result).toContain('Content');
            expect(result).not.toContain('onclick');
        });
    });
});
