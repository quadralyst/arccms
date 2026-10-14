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

    describe('Custom Field Aliasing', () => {
        it('exposes a slug-prefixed field under its bare name', () => {
            const html = '<h3>{{ details_heading }}</h3>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                contentTypeSlug: 'events',
                events_details_heading: 'At a glance',
            });
            expect(result).toContain('At a glance');
        });

        it('keeps the prefixed name working too', () => {
            const html = '<h3>{{ events_details_heading }}</h3>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                contentTypeSlug: 'events',
                events_details_heading: 'At a glance',
            });
            expect(result).toContain('At a glance');
        });

        it('never shadows a built-in binding', () => {
            // A field keyed `articles_title` must not replace the page title.
            const html = '<h1>{{ title }}</h1>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                contentTypeSlug: 'articles',
                title: 'The real title',
                articles_title: 'A custom field',
            });

            expect(result).toContain('The real title');
            expect(result).not.toContain('A custom field');
        });

        it('does nothing without a content type slug', () => {
            const result = TemplateHydrationService.hydrateTemplate(
                '<p>[{{ details_heading }}]</p>',
                { events_details_heading: 'At a glance' },
            );
            expect(result).toContain('[]');
        });

        it('ignores a key that is only the prefix', () => {
            const result = TemplateHydrationService.hydrateTemplate(
                '<p>[{{ x }}]</p>',
                { contentTypeSlug: 'events', events_: 'nothing' },
            );
            expect(result).toContain('[]');
        });

        it('works with a hyphenated slug', () => {
            const result = TemplateHydrationService.hydrateTemplate(
                '<h3>{{ details_heading }}</h3>',
                { contentTypeSlug: 'awards-recognition', 'awards-recognition_details_heading': 'Key facts' },
            );
            expect(result).toContain('Key facts');
        });

        it('does not mutate the caller data object', () => {
            const data: Record<string, any> = {
                contentTypeSlug: 'events',
                events_details_heading: 'At a glance',
            };
            TemplateHydrationService.hydrateTemplate('<h3>{{ details_heading }}</h3>', data);
            expect(Object.keys(data).sort()).toEqual(['contentTypeSlug', 'events_details_heading']);
        });

        it('aliases an icon field, and still flattens the token', () => {
            const result = TemplateHydrationService.hydrateTemplate(
                '<i class="{{ card_icon }}"></i>',
                {
                    contentTypeSlug: 'programs',
                    programs_card_icon: { classes: 'fa-solid fa-star', name: 'star' },
                },
            );
            expect(result).toContain('class="fa-solid fa-star"');
        });
    });

    describe('iframe binding', () => {
        it('sets an iframe src rather than its content', () => {
            // An iframe's payload is its src. Binding into its content leaves
            // the frame blank — how a gallery video or a map would ship as an
            // empty box.
            const html = '<iframe data-arc-bind="embed"></iframe>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                embed: 'https://www.youtube-nocookie.com/embed/abc',
            });

            expect(result).toContain('src="https://www.youtube-nocookie.com/embed/abc"');
            expect(result).not.toContain('>https://www.youtube-nocookie.com');
        });

        it('keeps other iframe attributes intact', () => {
            const html = '<iframe data-arc-bind="embed" loading="lazy" title="Map"></iframe>';
            const result = TemplateHydrationService.hydrateTemplate(html, { embed: 'https://example.com/x' });

            expect(result).toContain('loading="lazy"');
            expect(result).toContain('title="Map"');
        });
    });

    describe('Location Flattening', () => {
        const ROWS = [
            { id: 'r_a', position: 1, label: 'Head office', address: 'FC Road, Pune', lat: 18.5204, lng: 73.8567, zoom: 15 },
            { id: 'r_b', position: 2, label: 'Not placed yet', address: '', lat: null, lng: null, zoom: null },
        ];

        it('derives the embed, directions and view links per row', () => {
            const html = '<div data-arc-loop="offices">'
                + '<article data-arc-if="map_embed">'
                + '<iframe data-arc-bind="map_embed" title="{{ label }}"></iframe>'
                + '<a data-arc-bind="map_directions">Directions</a>'
                + '<p data-arc-bind="address">Address</p>'
                + '</article></div>';

            const result = TemplateHydrationService.processLoops(
                html,
                TemplateHydrationService.arrayLoopData({ offices: ROWS }),
            );

            expect(result).toContain('openstreetmap.org/export/embed.html');
            expect(result).toContain('google.com/maps/dir');
            expect(result).toContain('FC Road, Pune');
        });

        it('drops the block for a row with no point placed', () => {
            const html = '<div data-arc-loop="offices">'
                + '<article data-arc-if="map_embed"><iframe data-arc-bind="map_embed"></iframe></article>'
                + '</div>';

            const result = TemplateHydrationService.processLoops(
                html,
                TemplateHydrationService.arrayLoopData({ offices: ROWS }),
            );

            // One row has coordinates, one does not — a map of the Atlantic
            // would be worse than no map.
            expect(result.match(/<iframe/g)).toHaveLength(1);
        });

        it('leaves the stored coordinates untouched', () => {
            const result = TemplateHydrationService.hydrateTemplate(
                '<span>{{ lat }},{{ lng }}</span>',
                { lat: 18.5204, lng: 73.8567 },
            );
            expect(result).toContain('18.5204,73.8567');
        });

        it('adds nothing when a row has no coordinates at all', () => {
            const result = TemplateHydrationService.hydrateTemplate(
                '<span>[{{ map_embed }}]</span>',
                { address: 'Somewhere' },
            );
            expect(result).toContain('[]');
        });

        it('does not mutate the caller data object', () => {
            const data: Record<string, any> = { lat: 18.5204, lng: 73.8567 };
            TemplateHydrationService.hydrateTemplate('<span>{{ map_embed }}</span>', data);
            expect(Object.keys(data).sort()).toEqual(['lat', 'lng']);
        });

        it('works for a single location stored at the top level', () => {
            // A non-repeating location field would flatten the same way.
            const result = TemplateHydrationService.hydrateTemplate(
                '<iframe data-arc-bind="map_embed"></iframe>',
                { lat: 0, lng: 0 },
            );
            expect(result).toContain('openstreetmap.org/export/embed.html');
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
            const html = '<i class="card-icon {{ featured-services_icon }}"></i>';
            const result = TemplateHydrationService.hydrateTemplate(html, {
                'featured-services_icon': { classes: 'fa-solid fa-star', name: 'star' },
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

describe('File fields (docs/features/templates.html, MF-D18)', () => {
    const brochure = [
        { url: 'https://x/o/mediaFiles%2Fbrochure.pdf?alt=media', title: 'Brochure', type: 'pdf', bytes: 2411724, pages: 12 },
        { url: 'https://x/o/mediaFiles%2Fprices.xlsx?alt=media', title: 'Prices', type: 'excel', bytes: 20480 },
    ];

    it('binds the first file beside the field, outside any loop', () => {
        const html = '<a href="{{ events_brochure_url }}">{{ events_brochure_title }}</a> <small>{{ events_brochure_type }}, {{ events_brochure_size }}, {{ events_brochure_pages }}</small>';
        const result = TemplateHydrationService.hydrateTemplate(html, { events_brochure: brochure });
        expect(result).toContain('href="https://x/o/mediaFiles%2Fbrochure.pdf?alt=media"');
        expect(result).toContain('>Brochure</a>');
        expect(result).toContain('PDF, 2.3 MB, 12');
    });

    it('lists every file in the loop of the same name, as type, size and pages', () => {
        const html = '<ul data-arc-loop="events_brochure"><li class="file-{{ kind }}"><a href="{{ url }}">{{ title }}</a> {{ type }} {{ size }}</li></ul>';
        const result = TemplateHydrationService.processLoops(html, TemplateHydrationService.arrayLoopData({ events_brochure: brochure }));
        expect(result).toContain('class="file-pdf"');
        expect(result).toContain('Brochure</a> PDF 2.3 MB');
        expect(result).toContain('Prices</a> Excel 20 KB');
    });

    it('leaves other lists alone', () => {
        const rows = [{ image: 'https://x/a.jpg', caption: 'Crowd' }];
        expect(TemplateHydrationService.arrayLoopData({ gallery: rows })['gallery']).toEqual(rows);
        const result = TemplateHydrationService.hydrateTemplate('<i>{{ gallery_url }}</i>', { gallery: rows });
        expect(result).not.toContain('https://x/a.jpg');
    });
});

describe('Repeat from a number (data-arc-repeat, docs/features/templates.html)', () => {
    /** The hydrated fragment without the document cheerio wraps it in. */
    const body = (html: string) => html.replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '');
    const fill = (html: string, data: Record<string, unknown>) => body(TemplateHydrationService.hydrateTemplate(html, data));
    const count = (html: string, needle: string) => html.split(needle).length - 1;

    const STARS = '<p data-arc-repeat="rating"><i class="full"></i><i class="half"></i></p>';
    const DOTS = '<p data-arc-repeat="rating" data-max="4"><b class="{{ @state }}">{{ @number }}</b></p>';
    const THREE = '<p data-arc-repeat="rating"><i class="full"></i><i class="half"></i><i class="empty"></i></p>';

    // [case, template, data, the exact output]; the app's spec runs the same cases.
    const CASES: [string, string, Record<string, unknown>, string][] = [
        ['a whole number, one child', '<p data-arc-repeat="rating"><i>*</i></p>', { rating: 3 }, '<p><i>*</i><i>*</i><i>*</i></p>'],
        ['a number written as text', '<p data-arc-repeat="rating"><i>*</i></p>', { rating: ' 2 ' }, '<p><i>*</i><i>*</i></p>'],
        ['a number in the attribute', '<ol data-arc-repeat="3"><li>{{ @number }}</li></ol>', {}, '<ol><li>1</li><li>2</li><li>3</li></ol>'],
        ['full and half children', STARS, { rating: '3.5' }, '<p><i class="full"></i><i class="full"></i><i class="full"></i><i class="half"></i></p>'],
        ['a fraction under .25 rounds down', STARS, { rating: 2.2 }, '<p><i class="full"></i><i class="full"></i></p>'],
        ['a fraction from .75 rounds up', STARS, { rating: 2.75 }, '<p><i class="full"></i><i class="full"></i><i class="full"></i></p>'],
        ['two children never add empty slots', '<p data-arc-repeat="rating" data-max="5"><i class="full"></i><i class="half"></i></p>', { rating: 4.5 },
            '<p><i class="full"></i><i class="full"></i><i class="full"></i><i class="full"></i><i class="half"></i></p>'],
        ['three children fill to five', THREE, { rating: 3.5 }, '<p><i class="full"></i><i class="full"></i><i class="full"></i><i class="half"></i><i class="empty"></i></p>'],
        ['three children fill to data-max from a key', '<p data-arc-repeat="rating" data-max="slots"><i class="full"></i><i class="half"></i><i class="empty"></i></p>',
            { rating: 1, slots: 3 }, '<p><i class="full"></i><i class="empty"></i><i class="empty"></i></p>'],
        ['one child with data-max shows every state', DOTS, { rating: 2.5 },
            '<p><b class="full">1</b><b class="full">2</b><b class="half">3</b><b class="empty">4</b></p>'],
        ['the @ values', '<p data-arc-repeat="rating" data-max="4"><b data-i="{{ @index }}" data-f="{{@fraction}}">{{ @value }}/{{ @max }}/{{ @total }} {{ @percent }}% {{ @itemPercent }}%</b></p>',
            { rating: 1.5 },
            '<p><b data-i="0" data-f="1.00">1.5/4/4 38% 25%</b><b data-i="1" data-f="0.50">1.5/4/4 38% 50%</b><b data-i="2" data-f="0.00">1.5/4/4 38% 75%</b><b data-i="3" data-f="0.00">1.5/4/4 38% 100%</b></p>'],
        ['an unknown @ word is left alone', '<p data-arc-repeat="1"><b>{{ @other }}</b></p>', {}, '<p><b>{{ @other }}</b></p>'],
        ['data-max caps the number', DOTS, { rating: 9 },
            '<p><b class="full">1</b><b class="full">2</b><b class="full">3</b><b class="full">4</b></p>'],
        ['a data-max that is not a number is ignored', '<p data-arc-repeat="rating" data-max="slots"><i>*</i></p>', { rating: 2 }, '<p><i>*</i><i>*</i></p>'],
        ['a data-max of 0 is ignored', '<p data-arc-repeat="rating" data-max="0"><i>*</i></p>', { rating: 2 }, '<p><i>*</i><i>*</i></p>'],
        ['text with no child element repeats, rounded', '<span data-arc-repeat="rating">★</span>', { rating: 4.6 }, '<span>★★★★★</span>'],
        ['a missing number empties the element', STARS, {}, '<p></p>'],
        ['a missing number with three children is all empty slots', THREE, {}, '<p>' + '<i class="empty"></i>'.repeat(5) + '</p>'],
        ['a number that is not one empties the element', STARS, { rating: 'five' }, '<p></p>'],
        ['a negative number empties the element', STARS, { rating: -3 }, '<p></p>'],
        ['zero empties the element', '<span data-arc-repeat="rating">★</span>', { rating: 0 }, '<span></span>'],
        ['a flag is not a number', STARS, { rating: true }, '<p></p>'],
        ['an object is not a number', STARS, { rating: { value: 4 } }, '<p></p>'],
        ['Infinity is not a number', STARS, { rating: 'Infinity' }, '<p></p>'],
        ['the data adds no markup', '<p data-arc-repeat="rating"><i title="{{ @value }}">{{ @state }}</i></p>',
            { rating: '2<img src=x onerror=alert(1)>' }, '<p><i title="2">full</i><i title="2">full</i></p>'],
        ['each copy is filled like the template', '<ul data-arc-repeat="rating"><li>{{ title }} {{ @number }}</li></ul>',
            { rating: 2, title: 'A &amp; B' }, '<ul><li>A &amp;amp; B 1</li><li>A &amp;amp; B 2</li></ul>'],
        ['the short key of a custom field', STARS, { 'reviews-rating': 1, contentTypeSlug: 'reviews' }, '<p><i class="full"></i></p>'],
        ['with data-arc-if on the same element', '<p data-arc-if="rating" data-arc-repeat="rating"><i>*</i></p><em>x</em>', { rating: 0 }, '<em>x</em>'],
        ['a repeat inside a repeat reads its own @ values', '<ol data-arc-repeat="2"><li><b data-arc-repeat="2"><i>{{ @number }}</i></b></li></ol>', {},
            '<ol><li><b><i>1</i><i>2</i></b></li><li><b><i>1</i><i>2</i></b></li></ol>'],
    ];

    it.each(CASES)('%s', (_label, html, data, out) => {
        expect(fill(html, data)).toBe(out);
    });

    it('makes at most 100 copies', () => {
        const out = fill('<p data-arc-repeat="rating"><i></i></p>', { rating: 1e9 });
        expect(count(out, '<i>')).toBe(100);
    });

    it('stops a repeat inside a repeat from growing the page without bound', () => {
        const html = '<div data-arc-repeat="100"><p data-arc-repeat="100"><b data-arc-repeat="100"><i></i></b></p></div>';
        const out = fill(html, {});
        expect(count(out, '<i>') + count(out, '<b>') + count(out, '<p>')).toBeLessThanOrEqual(10000);
        expect(out).not.toContain('data-arc-repeat');
    });

    it('reads each row\'s own number inside a loop', () => {
        const html = '<ul data-arc-loop="items"><li>{{ title }}: <span data-arc-repeat="rating" data-max="5"><i class="full"></i><i class="half"></i></span></li></ul>';
        const looped = TemplateHydrationService.processLoops(html, {
            items: [
                { title: 'Alex', 'testimonials_rating': 5, contentTypeSlug: 'testimonials' },
                { title: 'Sam', 'testimonials_rating': '3.5', contentTypeSlug: 'testimonials' },
            ],
        });
        const out = body(TemplateHydrationService.hydrateTemplate(looped, { title: 'Page', rating: 1 }));
        expect(out).toContain('Alex: <span>' + '<i class="full"></i>'.repeat(5) + '</span>');
        expect(out).toContain('Sam: <span>' + '<i class="full"></i>'.repeat(3) + '<i class="half"></i></span>');
    });
});
