/**
 * Tests for Template Hydration Service
 *
 * Tests verify the TemplateHydrationService functionality including:
 * - HTML template hydration with data bindings
 * - Loop processing for list data
 * - Combined template processing
 * - Date formatting
 * - HTML sanitization
 */

import { describe, it, expect } from 'vitest';
import { TemplateHydrationService } from './template-hydration.service';

describe('TemplateHydrationService', () => {
    describe('hydrateTemplate', () => {
        it('should replace text content with data-arc-bind attribute', () => {
            const html = '<h1 data-arc-bind="title">Placeholder</h1>';
            const data = { title: 'Hello World' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('Hello World');
            expect(result).not.toContain('data-arc-bind');
            expect(result).not.toContain('Placeholder');
        });

        it('should handle multiple bindings in same template', () => {
            const html = `
                <h1 data-arc-bind="title">Title</h1>
                <p data-arc-bind="description">Desc</p>
            `;
            const data = { title: 'My Title', description: 'My Description' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('My Title');
            expect(result).toContain('My Description');
        });

        it('should set src attribute for img elements', () => {
            const html = '<img data-arc-bind="image" src="" />';
            const data = { image: '/path/to/image.jpg', title: 'Alt text' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('src="/path/to/image.jpg"');
            expect(result).toContain('alt="Alt text"');
        });

        it('should set href attribute for anchor elements', () => {
            const html = '<a data-arc-bind="link">Click here</a>';
            const data = { link: 'https://example.com' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('href="https://example.com"');
        });

        it('should handle HTML content in text bindings', () => {
            const html = '<div data-arc-bind="content">Empty</div>';
            const data = { content: '<strong>Bold text</strong>' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('<strong>Bold text</strong>');
        });

        it('should not modify elements when data key is missing', () => {
            const html = '<h1 data-arc-bind="missing">Original</h1>';
            const data = { other: 'value' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('Original');
            expect(result).toContain('data-arc-bind="missing"');
        });

        it('should handle null and undefined values', () => {
            const html = '<span data-arc-bind="value">Default</span>';
            const data = { value: null };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            // Should not replace when value is null
            expect(result).toContain('Default');
        });

        it('should set datetime attribute for time elements', () => {
            const html = '<time data-arc-bind="date">Date</time>';
            const data = { date: '2024-01-15T10:30:00Z' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('datetime="2024-01-15T10:30:00Z"');
        });

        it('should handle style background bindings', () => {
            const html = '<div data-arc-style-background="color">Content</div>';
            const data = { color: '#ff5500' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('background-color: #ff5500');
            expect(result).not.toContain('data-arc-style-background');
        });

    });

    describe('Angular-style Interpolation', () => {
        it('should replace {{ variable }} in text content', () => {
            const html = '<h1>{{ title }}</h1>';
            const data = { title: 'Hello Angular' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('<h1>Hello Angular</h1>');
        });

        it('should replace {{ variable }} in attributes', () => {
            const html = '<img src="{{ imageUrl }}" alt="{{ altText }}">';
            const data = { imageUrl: '/path/image.jpg', altText: 'An image' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('src="/path/image.jpg"');
            expect(result).toContain('alt="An image"');
        });

        it('should handle multiple interpolations in one string', () => {
            const html = '<p>{{ greeting }}, {{ name }}!</p>';
            const data = { greeting: 'Hello', name: 'User' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('Hello, User!');
        });

        it('should replace undefined values with empty string', () => {
            const html = '<p>Value: {{ missing }}</p>';
            const data = { existing: 'value' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('<p>Value: </p>');
        });

        it('should resolve nested keys in interpolation', () => {
            const html = '<p>{{ user.name }} - {{ user.details.age }}</p>';
            const data = { user: { name: 'John', details: { age: 30 } } };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('John - 30');
        });

        it('should support both data-arc-bind and interpolation', () => {
            const html = '<h1 data-arc-bind="title">Old</h1><p>{{ description }}</p>';
            const data = { title: 'Legacy Title', description: 'New Description' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('Legacy Title');
            expect(result).toContain('New Description');
        });

        it('should handle interpolation inside loops', () => {
             const html = `
                <ul data-arc-loop="items">
                    <li>{{ name }} - {{ id }}</li>
                </ul>
            `;
            const listData = { items: [{ name: 'Item A', id: 1 }, { name: 'Item B', id: 2 }] };

            const result = TemplateHydrationService.processLoops(html, listData);

            expect(result).toContain('Item A - 1');
            expect(result).toContain('Item B - 2');
        });
        it('should be safe from double interpolation (security check)', () => {
            const html = '<div data-arc-bind="unsafe">{{ safe }}</div>';
            const data = { 
                unsafe: '{{ malicious }}', 
                safe: 'safe content',
                malicious: 'I should not see this' 
            };
            const result = TemplateHydrationService.hydrateTemplate(html, data);
            // data-arc-bind runs LAST, so it overwrites "safe content" with "{{ malicious }}"
            // Crucially, it should NOT then be re-interpolated to "I should not see this"
            expect(result).toContain('{{ malicious }}');
            expect(result).not.toContain('I should not see this');
        });

        it('should allow data-arc-bind to override interpolation', () => {
            const html = '<div data-arc-bind="priority">{{ original }}</div>';
            const data = { 
                priority: 'I win', 
                original: 'I lose' 
            };
            const result = TemplateHydrationService.hydrateTemplate(html, data);
            expect(result).toContain('I win');
            expect(result).not.toContain('I lose');
        });

        it('should remove .arc-skeleton class when hydrated', () => {
            const html = `
                <div id="wrapper">
                    <span class="arc-skeleton">{{ title }}</span>
                    <div data-arc-bind="content" class="arc-skeleton"></div>
                    <div [innerHTML]="htmlContent" class="arc-skeleton"></div>
                </div>
            `;
            const data = { 
                title: 'Hello',
                content: 'World',
                htmlContent: '<b>Bold</b>'
            };
            const result = TemplateHydrationService.hydrateTemplate(html, data);
            
            expect(result).toContain('<span>Hello</span>');
            expect(result).not.toContain('class="arc-skeleton"');
            expect(result).not.toContain('class=""');
            expect(result).toContain('<div>World</div>');
            expect(result).toContain('<div><b>Bold</b></div>');
        });


        it('should hydrate [attribute] bindings', () => {
             const html = `
                <div id="wrapper">
                    <a [href]="linkUrl">Link</a>
                    <img [src]="imageUrl" [alt]="imageAlt">
                    <div [data-id]="meta.id"></div>
                </div>
            `;
            const data = { 
                linkUrl: '/path/to/page',
                imageUrl: '/assets/image.png', 
                imageAlt: 'An image',
                meta: { id: 123 }
            };
            const result = TemplateHydrationService.hydrateTemplate(html, data);
            
            expect(result).toContain('href="/path/to/page"');
            expect(result).toContain('src="/assets/image.png"');
            expect(result).toContain('alt="An image"');
            expect(result).toContain('data-id="123"');
            expect(result).not.toContain('[href]');
            expect(result).not.toContain('[src]');
        });
    });
    describe('processLoops', () => {
        it('should expand loop template with array data', () => {
            const html = `
                <ul data-arc-loop="items">
                    <li data-arc-bind="name">Item</li>
                </ul>
            `;
            const listData = { items: [{ name: 'Item 1' }, { name: 'Item 2' }, { name: 'Item 3' }] };

            const result = TemplateHydrationService.processLoops(html, listData);

            expect(result).toContain('Item 1');
            expect(result).toContain('Item 2');
            expect(result).toContain('Item 3');
            expect(result).not.toContain('data-arc-loop');
        });

        it('should respect data-limit attribute', () => {
            const html = `
                <ul data-arc-loop="items" data-limit="2">
                    <li data-arc-bind="name">Item</li>
                </ul>
            `;
            const listData = { items: [{ name: 'Item 1' }, { name: 'Item 2' }, { name: 'Item 3' }] };

            const result = TemplateHydrationService.processLoops(html, listData);

            expect(result).toContain('Item 1');
            expect(result).toContain('Item 2');
            expect(result).not.toContain('Item 3');
        });

        it('should clear container when data array is empty', () => {
            const html = `
                <ul data-arc-loop="items">
                    <li data-arc-bind="name">Placeholder Item</li>
                </ul>
            `;
            const listData = { items: [] };

            const result = TemplateHydrationService.processLoops(html, listData);

            expect(result).not.toContain('Placeholder Item');
        });

        it('should handle multiple named loops', () => {
            const html = `
                <ul data-arc-loop="articles">
                    <li data-arc-bind="title">Article</li>
                </ul>
                <ul data-arc-loop="tags">
                    <li data-arc-bind="name">Tag</li>
                </ul>
            `;
            const listData = {
                articles: [{ title: 'Article 1' }],
                tags: [{ name: 'Tag 1' }, { name: 'Tag 2' }]
            };

            const result = TemplateHydrationService.processLoops(html, listData);

            expect(result).toContain('Article 1');
            expect(result).toContain('Tag 1');
            expect(result).toContain('Tag 2');
        });
    });

    describe('processTemplate', () => {
        it('should process both single bindings and loops', () => {
            const html = `
                <h1 data-arc-bind="pageTitle">Title</h1>
                <ul data-arc-loop="items">
                    <li data-arc-bind="name">Item</li>
                </ul>
            `;
            const data = { pageTitle: 'My Page' };
            const listData = { items: [{ name: 'First' }, { name: 'Second' }] };

            const result = TemplateHydrationService.processTemplate(html, data, listData);

            expect(result).toContain('My Page');
            expect(result).toContain('First');
            expect(result).toContain('Second');
        });

        it('should handle template with only single bindings', () => {
            const html = '<h1 data-arc-bind="title">Title</h1>';
            const data = { title: 'Only Title' };

            const result = TemplateHydrationService.processTemplate(html, data);

            expect(result).toContain('Only Title');
        });

        it('should handle template with only loops', () => {
            const html = `
                <ul data-arc-loop="items">
                    <li data-arc-bind="name">Item</li>
                </ul>
            `;
            const listData = { items: [{ name: 'Loop Only' }] };

            const result = TemplateHydrationService.processTemplate(html, undefined, listData);

            expect(result).toContain('Loop Only');
        });

        it('should return original HTML when no data provided', () => {
            const html = '<h1 data-arc-bind="title">Original</h1>';

            const result = TemplateHydrationService.processTemplate(html);

            expect(result).toContain('Original');
        });
    });

    describe('sanitizeHtml', () => {
        it('should remove script tags', () => {
            const html = '<div>Content</div><script>alert("xss")</script>';

            const result = TemplateHydrationService.sanitizeHtml(html);

            expect(result).not.toContain('<script');
            expect(result).not.toContain('alert');
            expect(result).toContain('Content');
        });

        it('should remove inline event handlers with double quotes', () => {
            const html = '<button onclick="doSomething()">Click</button>';

            const result = TemplateHydrationService.sanitizeHtml(html);

            expect(result).not.toContain('onclick');
            expect(result).toContain('Click');
        });

        it('should remove inline event handlers with single quotes', () => {
            const html = "<button onmouseover='malicious()'>Hover</button>";

            const result = TemplateHydrationService.sanitizeHtml(html);

            expect(result).not.toContain('onmouseover');
            expect(result).toContain('Hover');
        });

        it('should handle multiple event handlers', () => {
            const html = '<div onclick="a()" onload="b()">Content</div>';

            const result = TemplateHydrationService.sanitizeHtml(html);

            expect(result).not.toContain('onclick');
            expect(result).not.toContain('onload');
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty HTML string', () => {
            const result = TemplateHydrationService.hydrateTemplate('', {});
            expect(result).toBeDefined();
        });

        it('should handle HTML with no bindings', () => {
            const html = '<div><p>Static content</p></div>';
            const data = { unused: 'value' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('Static content');
        });

        it('should handle nested elements with bindings', () => {
            const html = `
                <div>
                    <article>
                        <header>
                            <h1 data-arc-bind="title">Title</h1>
                        </header>
                        <section>
                            <p data-arc-bind="content">Content</p>
                        </section>
                    </article>
                </div>
            `;
            const data = { title: 'Deep Title', content: 'Deep Content' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('Deep Title');
            expect(result).toContain('Deep Content');
        });

        it('should handle special characters in data values', () => {
            const html = '<span data-arc-bind="text">Text</span>';
            const data = { text: 'Hello & Goodbye <world>' };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            // Should escape special characters in text content
            expect(result).toContain('Hello');
            expect(result).toContain('Goodbye');
        });
    });

    describe('data-arc-if', () => {
        it('should remove element when value is false', () => {
            const html = '<div data-arc-if="isVisible">Content</div>';
            const data = { isVisible: false };
            const result = TemplateHydrationService.hydrateTemplate(html, data);
            expect(result).not.toContain('Content');
        });

        it('should remove element when value is null', () => {
             const html = '<div data-arc-if="value">Content</div>';
             const data = { value: null };
             const result = TemplateHydrationService.hydrateTemplate(html, data);
             expect(result).not.toContain('Content');
        });

        it('should remove element when value is undefined', () => {
             const html = '<div data-arc-if="value">Content</div>';
             const data = { };
             const result = TemplateHydrationService.hydrateTemplate(html, data);
             expect(result).not.toContain('Content');
        });

        it('should keep element when value is true', () => {
             const html = '<div data-arc-if="isVisible">Content</div>';
             const data = { isVisible: true };
             const result = TemplateHydrationService.hydrateTemplate(html, data);
             expect(result).toContain('Content');
             expect(result).not.toContain('data-arc-if');
        });

        it('should resolve nested keys', () => {
             const html = '<div data-arc-if="config.enabled">Enabled</div>';
             const data = { config: { enabled: true } };
             const result = TemplateHydrationService.hydrateTemplate(html, data);
             expect(result).toContain('Enabled');
        });

        it('should remove element when nested key is falsy', () => {
             const html = '<div data-arc-if="config.enabled">Enabled</div>';
             const data = { config: { enabled: false } };
             const result = TemplateHydrationService.hydrateTemplate(html, data);
             expect(result).not.toContain('Enabled');
        });

        it('should work inside loops via processLoops', () => {
             const html = `
                 <ul data-arc-loop="items">
                     <li>
                         <span>{{ name }}</span>
                         <img data-arc-if="coverImage" [src]="coverImage">
                     </li>
                 </ul>
             `;
             const listData = {
                 items: [
                     { name: 'With Image', coverImage: '/img.jpg' },
                     { name: 'No Image', coverImage: '' },
                 ]
             };
             const result = TemplateHydrationService.processLoops(html, listData);
             expect(result).toContain('With Image');
             expect(result).toContain('src="/img.jpg"');
             expect(result).toContain('No Image');
             // The img for "No Image" should be removed since coverImage is falsy
             // Count img tags - should be exactly 1
             const imgCount = (result.match(/<img/g) || []).length;
             expect(imgCount).toBe(1);
        });
        
        it('should take precedence over data-arc-bind', () => {
             const html = '<div data-arc-if="show" data-arc-bind="text">Default</div>';
             const data = { show: false, text: 'New Text' };
             const result = TemplateHydrationService.hydrateTemplate(html, data);
             expect(result).not.toContain('New Text');
             expect(result).not.toContain('Default');
        });
    });

    describe('Video Flattening', () => {
        const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s';

        it('derives the id, embed and poster from a stored URL', () => {
            const html = '<span>{{ video_id }}|{{ video_embed }}|{{ video_thumb }}</span>';
            const result = TemplateHydrationService.hydrateTemplate(html, { video: URL });

            expect(result).toContain('dQw4w9WgXcQ');
            expect(result).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
            expect(result).toContain('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
        });

        it('leaves the original URL untouched', () => {
            const result = TemplateHydrationService.hydrateTemplate('<a data-arc-bind="video">x</a>', { video: URL });
            // `&` is entity-encoded on the way into the attribute, which is
            // correct HTML — the value itself is unchanged.
            expect(result).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=30s"');
        });

        it('ignores a string that is not a YouTube link', () => {
            const html = '<span>[{{ summary_id }}]</span>';
            const result = TemplateHydrationService.hydrateTemplate(html, { summary: 'https://example.com/page' });
            // An unrelated field holding a URL must not sprout derived keys.
            expect(result).toContain('[]');
        });

        it('does not mutate the caller data object', () => {
            const data: Record<string, any> = { video: URL };
            TemplateHydrationService.hydrateTemplate('<span>{{ video_id }}</span>', data);
            expect(Object.keys(data)).toEqual(['video']);
        });

        it('derives per row inside a gallery loop', () => {
            const html = '<div data-arc-loop="gallery">'
                + '<figure>'
                + '<img data-arc-if="image" data-arc-bind="image" alt="">'
                + '<a data-arc-if="video_embed" data-arc-bind="video_embed">'
                + '<img data-arc-bind="video_thumb" alt=""></a>'
                + '<figcaption>{{ caption }}</figcaption>'
                + '</figure></div>';
            const rows = [
                { id: 'r_a', position: 1, image: 'https://example.com/photo.jpg', video: '', caption: 'A photo' },
                { id: 'r_b', position: 2, image: '', video: 'https://youtu.be/dQw4w9WgXcQ', caption: 'A video' },
            ];

            const result = TemplateHydrationService.processLoops(
                html,
                TemplateHydrationService.arrayLoopData({ gallery: rows }),
            );

            expect(result).toContain('https://example.com/photo.jpg');
            expect(result).toContain('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
            expect(result).toContain('href="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
            expect(result).toContain('A photo');
            expect(result).toContain('A video');
            // The photo row has no video, so its anchor is removed entirely.
            expect(result.match(/<a /g)).toHaveLength(1);
        });
    });

    describe('Hyphenated custom field keys', () => {
        // Custom fields are stored prefixed with their content type slug, so a
        // field on `awards-recognition` is keyed `awards-recognition_subtitle`.
        // Hyphens in an interpolation key used to leave the binding as literal
        // text on exactly the content types most likely to have one.
        it('interpolates a slug-prefixed key containing hyphens', () => {
            const html = '<p>{{ awards-recognition_subtitle }}</p>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                'awards-recognition_subtitle': 'Honoured in 2026',
            });

            expect(result).toContain('Honoured in 2026');
            expect(result).not.toContain('{{');
        });

        it('interpolates a hyphenated key inside an attribute', () => {
            const html = '<i class="card-icon {{ flagship-programs_icon }}"></i>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                'flagship-programs_icon': { classes: 'fa-solid fa-star', name: 'star' },
            });

            expect(result).toContain('class="card-icon fa-solid fa-star"');
        });

        it('loops over a hyphenated repeating field key', () => {
            const html = '<div data-arc-loop="zz-card-qa_info_cards"><p>{{ headline }}</p></div>';
            const rows = [{ id: 'r_a', position: 1, headline: 'First card' }];

            const result = TemplateHydrationService.processLoops(
                html,
                TemplateHydrationService.arrayLoopData({ 'zz-card-qa_info_cards': rows }),
            );

            expect(result).toContain('First card');
        });

        it('still leaves an unknown key resolving to empty', () => {
            const result = TemplateHydrationService.hydrateTemplate('<p>{{ no-such-key }}</p>', {});
            expect(result).toContain('<p></p>');
        });
    });

    describe('arrayLoopData', () => {
        const CARDS = [
            { id: 'r_b', position: 2, headline: 'Second' },
            { id: 'r_a', position: 1, headline: 'First' },
        ];

        it('turns an array custom field into a named loop', () => {
            expect(TemplateHydrationService.arrayLoopData({ info_cards: CARDS }))
                .toHaveProperty('info_cards');
        });

        it('sorts rows by position', () => {
            const loops = TemplateHydrationService.arrayLoopData({ info_cards: CARDS });
            expect(loops['info_cards'].map((r: any) => r.id)).toEqual(['r_a', 'r_b']);
        });

        it('leaves rows alone when they carry no position', () => {
            const rows = [{ id: 'r_b' }, { id: 'r_a' }];
            const loops = TemplateHydrationService.arrayLoopData({ info_cards: rows });
            expect(loops['info_cards'].map((r: any) => r.id)).toEqual(['r_b', 'r_a']);
        });

        it('does not mutate the stored rows', () => {
            const rows = [...CARDS];
            TemplateHydrationService.arrayLoopData({ info_cards: rows });
            expect(rows.map(r => r.id)).toEqual(['r_b', 'r_a']);
        });

        it('ignores scalar and object custom fields', () => {
            const loops = TemplateHydrationService.arrayLoopData({
                title: 'Not a loop',
                count: 3,
                cover: { url: 'x' },
                info_cards: CARDS,
            });
            expect(Object.keys(loops)).toEqual(['info_cards']);
        });

        it('ignores an array of plain strings', () => {
            // Tag-style arrays are not rows and would hydrate to nothing.
            expect(TemplateHydrationService.arrayLoopData({ keywords: ['a', 'b'] })).toEqual({});
        });

        it('never displaces a reserved loop name', () => {
            // A custom field keyed `tags` must not shadow the built-in loop a
            // template already relies on.
            const loops = TemplateHydrationService.arrayLoopData(
                { tags: [{ name: 'Fake' }], info_cards: CARDS },
                ['tags', 'items'],
            );
            expect(Object.keys(loops)).toEqual(['info_cards']);
        });

        it('handles a missing customFields object', () => {
            expect(TemplateHydrationService.arrayLoopData(undefined)).toEqual({});
            expect(TemplateHydrationService.arrayLoopData(null)).toEqual({});
        });

        it('renders info card rows, icon and all, through processLoops', () => {
            const html = '<div data-arc-loop="info_cards">'
                + '<article><i class="{{ icon }}"></i><h3>{{ headline }}</h3><p>{{ info }}</p></article>'
                + '</div>';
            const rows = [
                {
                    id: 'r_a', position: 1, headline: 'Find opportunities', info: 'Browse needs.',
                    image: '', icon: { set: 'fa', name: 'magnifying-glass', classes: 'fa-solid fa-magnifying-glass' },
                },
                {
                    id: 'r_b', position: 2, headline: 'Earn coins', info: 'Redeem them.',
                    image: '', icon: { set: 'fa', name: 'coins', classes: 'fa-solid fa-coins' },
                },
            ];

            const result = TemplateHydrationService.processLoops(
                html,
                TemplateHydrationService.arrayLoopData({ info_cards: rows }),
            );

            expect(result).toContain('class="fa-solid fa-magnifying-glass"');
            expect(result).toContain('Find opportunities');
            expect(result).toContain('class="fa-solid fa-coins"');
            expect(result).toContain('Redeem them.');
            expect(result).not.toContain('[object Object]');
        });

        it('drops the visual a row does not have, via data-arc-if', () => {
            const html = '<div data-arc-loop="info_cards"><article>'
                + '<img data-arc-if="image" data-arc-bind="image" alt="">'
                + '<i data-arc-if="icon" class="{{ icon }}"></i>'
                + '<h3>{{ headline }}</h3></article></div>';
            const rows = [
                { id: 'r_a', position: 1, headline: 'Photo card', image: 'https://example.com/a.jpg', icon: null },
                { id: 'r_b', position: 2, headline: 'Icon card', image: '', icon: { set: 'fa', name: 'star', classes: 'fa-solid fa-star' } },
            ];

            const result = TemplateHydrationService.processLoops(
                html,
                TemplateHydrationService.arrayLoopData({ info_cards: rows }),
            );

            // One card keeps its <img> and loses the <i>; the other the reverse.
            expect(result.match(/<img/g)).toHaveLength(1);
            expect(result).toContain('https://example.com/a.jpg');
            expect(result).toContain('fa-solid fa-star');
        });

        it('empties the container when there are no rows', () => {
            const html = '<div data-arc-loop="info_cards"><article>{{ headline }}</article></div>';
            const result = TemplateHydrationService.processLoops(
                html,
                TemplateHydrationService.arrayLoopData({ info_cards: [] }),
            );

            // An empty array must clear the placeholder card, not publish it.
            expect(result).not.toContain('<article>');
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

    describe('Collection Reference Flattening', () => {
        it('should flatten _ref_author from customFields to ref_author on the data object', () => {
            const html = '<span>{{ ref_author.name }}</span>';
            const data = {
                title: 'My Article',
                customFields: {
                    _ref_author: { name: 'Jane Doe', id: 'author-1' },
                },
            };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('Jane Doe');
        });

        it('should not mutate the original data object', () => {
            const html = '<span>{{ ref_author.name }}</span>';
            const data: Record<string, any> = {
                title: 'My Article',
                customFields: {
                    _ref_author: { name: 'Jane Doe', id: 'author-1' },
                },
            };

            // Capture original keys before hydration
            const originalKeys = Object.keys(data).sort();

            TemplateHydrationService.hydrateTemplate(html, data);

            // The original data object should NOT have ref_author added directly
            // (the service creates a spread copy internally)
            expect(Object.keys(data).sort()).toEqual(originalKeys);
            expect(data['ref_author']).toBeUndefined();
        });

        it('should not overwrite existing keys with flattened ref keys', () => {
            const html = '<p>{{ ref_author }}</p>';
            const data: Record<string, any> = {
                title: 'My Article',
                ref_author: 'Original Author Value',
                customFields: {
                    _ref_author: { name: 'Injected Author', id: 'author-2' },
                },
            };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            // The existing ref_author should NOT be overwritten by the flattened value
            expect(result).toContain('Original Author Value');
            expect(result).not.toContain('Injected Author');
        });

        it('should work with nested ref data containing id, title, and other properties', () => {
            const html = '<div>{{ ref_category.title }} ({{ ref_category.id }})</div>';
            const data = {
                title: 'A Blog Post',
                customFields: {
                    _ref_category: {
                        id: 'cat-42',
                        title: 'Technology',
                        urlSlug: 'technology',
                        coverImage: '/images/tech.jpg',
                    },
                },
            };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('Technology');
            expect(result).toContain('cat-42');
        });

        it('should work when customFields has no _ref_ keys', () => {
            const html = '<h1>{{ title }}</h1>';
            const data = {
                title: 'Plain Article',
                customFields: {
                    category: 'General',
                    tags: 'news,updates',
                },
            };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('Plain Article');
        });

        it('should flatten multiple _ref_ keys from customFields', () => {
            const html = '<p>{{ ref_author.name }} - {{ ref_category.title }}</p>';
            const data = {
                title: 'Multi-Ref Article',
                customFields: {
                    _ref_author: { name: 'Alice', id: 'a-1' },
                    _ref_category: { title: 'Science', id: 'c-3' },
                },
            };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('Alice');
            expect(result).toContain('Science');
        });

        it('should not flatten when customFields is absent', () => {
            const html = '<h1>{{ title }}</h1>';
            const data = {
                title: 'No Custom Fields',
            };

            const result = TemplateHydrationService.hydrateTemplate(html, data);

            expect(result).toContain('No Custom Fields');
        });
    });

});
