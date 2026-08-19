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

        describe('unprefixed alias', () => {
            const ROWS = [{ id: 'r_a', position: 1, caption: 'One' }];

            it('publishes a loop under its bare key as well', () => {
                // A shared template cannot name `events_gallery`, because the
                // slug differs per content type.
                const loops = TemplateHydrationService.arrayLoopData(
                    { events_gallery: ROWS }, ['tags', 'items'], 'events',
                );
                expect(Object.keys(loops).sort()).toEqual(['events_gallery', 'gallery']);
                expect(loops['gallery']).toBe(loops['events_gallery']);
            });

            it('keeps underscores inside the field key', () => {
                const loops = TemplateHydrationService.arrayLoopData(
                    { events_info_cards: ROWS }, ['tags', 'items'], 'events',
                );
                expect(loops['info_cards']).toEqual(ROWS);
            });

            it('handles a hyphenated slug', () => {
                const loops = TemplateHydrationService.arrayLoopData(
                    { 'awards-recognition_gallery': ROWS }, ['tags', 'items'], 'awards-recognition',
                );
                expect(loops['gallery']).toEqual(ROWS);
            });

            it('adds no alias without a slug', () => {
                const loops = TemplateHydrationService.arrayLoopData({ events_gallery: ROWS }, ['tags', 'items']);
                expect(Object.keys(loops)).toEqual(['events_gallery']);
            });

            it('adds no alias to a key that lacks the prefix', () => {
                const loops = TemplateHydrationService.arrayLoopData(
                    { gallery: ROWS }, ['tags', 'items'], 'events',
                );
                expect(Object.keys(loops)).toEqual(['gallery']);
            });

            it('never aliases onto a reserved loop name', () => {
                // A field keyed `events_tags` must not shadow the built-in tags
                // loop every template already relies on.
                const loops = TemplateHydrationService.arrayLoopData(
                    { events_tags: ROWS }, ['tags', 'items'], 'events',
                );
                expect(loops['tags']).toBeUndefined();
                expect(loops['events_tags']).toEqual(ROWS);
            });

            it('lets an explicit key win over an alias for the same name', () => {
                const explicit = [{ id: 'r_x', position: 1, caption: 'Explicit' }];
                const loops = TemplateHydrationService.arrayLoopData(
                    { gallery: explicit, events_gallery: ROWS }, ['tags', 'items'], 'events',
                );
                expect(loops['gallery']).toEqual(explicit);
            });

            it('does not alias a bare slug-prefixed key with nothing after it', () => {
                const loops = TemplateHydrationService.arrayLoopData(
                    { events_: ROWS }, ['tags', 'items'], 'events',
                );
                expect(Object.keys(loops)).toEqual(['events_']);
            });

            it('renders a shared template through the alias', () => {
                const html = '<div data-arc-loop="gallery"><p>{{ caption }}</p></div>';
                const result = TemplateHydrationService.processLoops(
                    html,
                    TemplateHydrationService.arrayLoopData(
                        { events_gallery: ROWS }, ['tags', 'items'], 'events',
                    ),
                );
                expect(result).toContain('One');
            });
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
    

        it('clears a loop container the caller had no data for', () => {
            // A shared template carrying a gallery block would otherwise put a
            // literal "Caption" on every page of a type that has no gallery.
            const html = '<div data-arc-loop="gallery"><figure>Caption</figure></div>';
            const result = TemplateHydrationService.processLoops(html, { tags: [] });

            expect(result).not.toContain('<figure>');
            expect(result).not.toContain('Caption');
        });

        it('strips the loop attributes from an unmatched container', () => {
            const html = '<div data-arc-loop="gallery" data-limit="4"><p>x</p></div>';
            const result = TemplateHydrationService.processLoops(html, {});

            expect(result).not.toContain('data-arc-loop');
            expect(result).not.toContain('data-limit');
        });

        it('keeps the container itself, so its styling can hide it', () => {
            const html = '<div class="gallery" data-arc-loop="gallery"><p>x</p></div>';
            const result = TemplateHydrationService.processLoops(html, {});

            expect(result).toContain('class="gallery"');
        });

        it('clears only the containers without data', () => {
            const html = '<div data-arc-loop="tags"><span>{{ name }}</span></div>'
                + '<div data-arc-loop="gallery"><figure>Caption</figure></div>';
            const result = TemplateHydrationService.processLoops(html, {
                tags: [{ name: 'Real tag' }],
            });

            expect(result).toContain('Real tag');
            expect(result).not.toContain('Caption');
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
