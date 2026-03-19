import { describe, it, expect } from 'vitest';
import { IDraftContents, DraftContentsData, COMPONENT_NAME } from './draft-contents.model';

describe('Draft Contents Model', () => {
    describe('IDraftContents Interface', () => {
        it('should allow creating a valid draft content object', () => {
            const content: IDraftContents = {
                id: 'draft-id-123',
                title: 'Draft Article',
                content: '<p>Draft content</p>',
                urlSlug: 'draft-article',
                type: 'article',
                status: 'draft',
                coverImage: null,
                tags: ['draft', 'wip'],
                categoryIdArr: ['cat1'],
                categoryNameArr: ['Category 1'],
                seoTitle: 'Draft Article SEO',
                metaDescription: 'This is a draft article',
                canonicalUrl: '',
                publishedOn: null,
                publishedStatus: false,
                isFeatured: false,
                createdAt: new Date(),
                createdBy: 'user-123',
                modifiedAt: new Date(),
                modifiedBy: 'user-123'
            };

            expect(content).toBeDefined();
            expect(content.id).toBe('draft-id-123');
            expect(content.status).toBe('draft');
            expect(content.publishedStatus).toBe(false);
        });

        it('should allow draft with publish status (pending publish)', () => {
            const content: IDraftContents = {
                id: 'pub-draft-1',
                title: 'Published Draft',
                content: '<p>Content ready to publish</p>',
                urlSlug: 'published-draft',
                type: 'blog',
                status: 'publish',
                coverImage: 'https://example.com/image.jpg',
                tags: ['ready'],
                categoryIdArr: ['cat1'],
                categoryNameArr: ['Main Category'],
                seoTitle: 'Ready to Publish',
                metaDescription: 'Article ready for publishing',
                canonicalUrl: 'https://example.com/published-draft',
                publishedOn: new Date('2024-01-15'),
                publishedStatus: true,
                isFeatured: false,
                createdAt: new Date(),
                createdBy: 'admin-1',
                modifiedAt: new Date(),
                modifiedBy: 'admin-1'
            };

            expect(content.status).toBe('publish');
            expect(content.publishedStatus).toBe(true);
        });

        it('should support empty arrays', () => {
            const content: IDraftContents = {
                id: 'minimal-draft',
                title: '',
                content: '',
                urlSlug: '',
                type: 'page',
                status: 'draft',
                coverImage: null,
                tags: [],
                categoryIdArr: [],
                categoryNameArr: [],
                seoTitle: '',
                metaDescription: '',
                canonicalUrl: '',
                publishedOn: null,
                publishedStatus: false,
                isFeatured: false,
                createdAt: new Date(),
                createdBy: 'user-1',
                modifiedAt: new Date(),
                modifiedBy: 'user-1'
            };

            expect(content.tags).toEqual([]);
            expect(content.categoryIdArr).toEqual([]);
        });

        it('should support cover image as data URL', () => {
            const content: IDraftContents = {
                id: 'image-draft',
                title: 'Draft with Image',
                content: '<p>Content with cover</p>',
                urlSlug: 'image-draft',
                type: 'article',
                status: 'draft',
                coverImage: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
                tags: [],
                categoryIdArr: [],
                categoryNameArr: [],
                seoTitle: '',
                metaDescription: '',
                canonicalUrl: '',
                publishedOn: null,
                publishedStatus: false,
                isFeatured: false,
                createdAt: new Date(),
                createdBy: 'user-1',
                modifiedAt: new Date(),
                modifiedBy: 'user-1'
            };

            expect(content.coverImage).toContain('data:image');
        });

        it('should track modification timestamps', () => {
            const createdAt = new Date('2024-01-01');
            const modifiedAt = new Date('2024-01-05');

            const content: IDraftContents = {
                id: 'timestamped-draft',
                title: 'Timestamped Draft',
                content: '<p>Content</p>',
                urlSlug: 'timestamped-draft',
                type: 'article',
                status: 'draft',
                coverImage: null,
                tags: [],
                categoryIdArr: [],
                categoryNameArr: [],
                seoTitle: '',
                metaDescription: '',
                canonicalUrl: '',
                publishedOn: null,
                publishedStatus: false,
                isFeatured: false,
                createdAt: createdAt,
                createdBy: 'user-1',
                modifiedAt: modifiedAt,
                modifiedBy: 'editor-1'
            };

            expect(content.createdAt).toEqual(createdAt);
            expect(content.modifiedAt).toEqual(modifiedAt);
            expect(content.modifiedBy).not.toBe(content.createdBy);
        });
    });

    describe('DraftContentsData Type', () => {
        it('should omit common fields from IDraftContents', () => {
            const contentData: DraftContentsData = {
                id: 'data-id',
                title: 'Data Title',
                content: '<p>Data content</p>',
                urlSlug: 'data-title',
                type: 'article',
                status: 'draft',
                coverImage: null,
                tags: [],
                categoryIdArr: [],
                categoryNameArr: [],
                seoTitle: '',
                metaDescription: '',
                canonicalUrl: '',
                publishedOn: null,
                publishedStatus: false,
                isFeatured: false
            };

            expect(contentData).toBeDefined();
            // @ts-expect-error - createdAt should not exist on DraftContentsData
            expect(contentData.createdAt).toBeUndefined();
        });
    });

    describe('COMPONENT_NAME Constant', () => {
        it('should have the correct component name', () => {
            expect(COMPONENT_NAME).toBe('DraftContents');
        });

        it('should be a string type', () => {
            expect(typeof COMPONENT_NAME).toBe('string');
        });
    });

    describe('Draft vs Published Status', () => {
        it('should distinguish between draft and published content', () => {
            const draft: IDraftContents = {
                id: 'draft-1',
                title: 'Draft',
                content: '',
                urlSlug: 'draft',
                type: 'article',
                status: 'draft',
                coverImage: null,
                tags: [],
                categoryIdArr: [],
                categoryNameArr: [],
                seoTitle: '',
                metaDescription: '',
                canonicalUrl: '',
                publishedOn: null,
                publishedStatus: false,
                isFeatured: false,
                createdAt: new Date(),
                createdBy: 'user-1',
                modifiedAt: new Date(),
                modifiedBy: 'user-1'
            };

            const published: IDraftContents = {
                ...draft,
                id: 'published-1',
                status: 'publish',
                publishedOn: new Date(),
                publishedStatus: true
            };

            expect(draft.publishedStatus).toBe(false);
            expect(draft.publishedOn).toBeNull();
            expect(published.publishedStatus).toBe(true);
            expect(published.publishedOn).not.toBeNull();
        });
    });
});
