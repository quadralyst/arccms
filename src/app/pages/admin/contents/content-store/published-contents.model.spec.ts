import { describe, it, expect } from 'vitest';
import { IContents, IContentsData, COMPONENT_NAME } from './published-contents.model';

describe('Published Contents Model', () => {
    describe('IContents Interface', () => {
        it('should allow creating a valid content object', () => {
            const content: IContents = {
                id: 'test-id-123',
                title: 'Test Article',
                content: '<p>Test content</p>',
                urlSlug: 'test-article',
                type: 'article',
                status: 'draft',
                coverImage: null,
                tags: ['tech', 'testing'],
                categoryIdArr: ['cat1', 'cat2'],
                categoryNameArr: ['Category 1', 'Category 2'],
                seoTitle: 'Test Article SEO',
                metaDescription: 'This is a test article',
                canonicalUrl: 'https://example.com/test-article',
                publishedOn: null,
                publishedStatus: false,
                isFeatured: false,
                createdAt: new Date(),
                createdBy: 'user-123',
                modifiedAt: new Date(),
                modifiedBy: 'user-123'
            };

            expect(content).toBeDefined();
            expect(content.id).toBe('test-id-123');
            expect(content.title).toBe('Test Article');
            expect(content.status).toBe('draft');
        });

        it('should allow content with publish status', () => {
            const content: IContents = {
                id: 'pub-content-1',
                title: 'Published Article',
                content: '<p>Published content</p>',
                urlSlug: 'published-article',
                type: 'blog',
                status: 'publish',
                coverImage: 'https://example.com/image.jpg',
                tags: ['featured'],
                categoryIdArr: ['cat1'],
                categoryNameArr: ['Main Category'],
                seoTitle: 'Published Article Title',
                metaDescription: 'A published article',
                canonicalUrl: 'https://example.com/published-article',
                publishedOn: new Date('2024-01-15'),
                publishedStatus: true,
                isFeatured: true,
                createdAt: new Date(),
                createdBy: 'admin-1',
                modifiedAt: new Date(),
                modifiedBy: 'admin-1'
            };

            expect(content.status).toBe('publish');
            expect(content.publishedStatus).toBe(true);
            expect(content.isFeatured).toBe(true);
            expect(content.coverImage).toBe('https://example.com/image.jpg');
        });

        it('should support empty arrays for tags and categories', () => {
            const content: IContents = {
                id: 'minimal-content',
                title: 'Minimal Content',
                content: '',
                urlSlug: 'minimal',
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
            expect(content.categoryNameArr).toEqual([]);
        });

        it('should support multiple tags', () => {
            const content: IContents = {
                id: 'tagged-content',
                title: 'Tagged Content',
                content: '<p>Content with tags</p>',
                urlSlug: 'tagged-content',
                type: 'article',
                status: 'draft',
                coverImage: null,
                tags: ['javascript', 'typescript', 'angular', 'testing', 'vitest'],
                categoryIdArr: [],
                categoryNameArr: [],
                seoTitle: 'Tagged Content',
                metaDescription: 'Content with multiple tags',
                canonicalUrl: '',
                publishedOn: null,
                publishedStatus: false,
                isFeatured: false,
                createdAt: new Date(),
                createdBy: 'user-1',
                modifiedAt: new Date(),
                modifiedBy: 'user-1'
            };

            expect(content.tags.length).toBe(5);
            expect(content.tags).toContain('angular');
        });

        it('should support nested categories', () => {
            const content: IContents = {
                id: 'nested-cat-content',
                title: 'Nested Category Content',
                content: '<p>Content with nested categories</p>',
                urlSlug: 'nested-category-content',
                type: 'article',
                status: 'publish',
                coverImage: null,
                tags: [],
                categoryIdArr: ['parent-cat-1', 'child-cat-1', 'grandchild-cat-1'],
                categoryNameArr: ['Technology', 'Web Development', 'Frontend'],
                seoTitle: 'Nested Content',
                metaDescription: 'Content with nested categories',
                canonicalUrl: '',
                publishedOn: new Date(),
                publishedStatus: true,
                isFeatured: false,
                createdAt: new Date(),
                createdBy: 'user-1',
                modifiedAt: new Date(),
                modifiedBy: 'user-1'
            };

            expect(content.categoryIdArr.length).toBe(3);
            expect(content.categoryNameArr.length).toBe(3);
            expect(content.categoryNameArr[2]).toBe('Frontend');
        });
    });

    describe('IContentsData Type', () => {
        it('should omit common fields from IContents', () => {
            const contentData: IContentsData = {
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
            expect(contentData.id).toBe('data-id');
            // @ts-expect-error - createdAt should not exist on IContentsData
            expect(contentData.createdAt).toBeUndefined();
        });
    });

    describe('COMPONENT_NAME Constant', () => {
        it('should have the correct component name', () => {
            expect(COMPONENT_NAME).toBe('Contents');
        });

        it('should be a string type', () => {
            expect(typeof COMPONENT_NAME).toBe('string');
        });
    });

    describe('Content Status', () => {
        it('should support draft status', () => {
            const status: 'draft' | 'publish' = 'draft';
            expect(status).toBe('draft');
        });

        it('should support publish status', () => {
            const status: 'draft' | 'publish' = 'publish';
            expect(status).toBe('publish');
        });
    });
});
