import { describe, it, expect } from 'vitest';
import { ITag, TagData, COMPONENT_NAME, getTagsCollectionName } from './tags.model';

describe('Tags Model', () => {
    describe('ITag Interface', () => {
        it('should create a valid tag object', () => {
            const tag: ITag = {
                id: 'tag-1',
                label: 'Technology',
                color: '#D81B60',
                contentTypeSlug: 'articles',
                usageCount: 5,
                createdBy: 'user-1',
                createdAt: new Date(),
                modifiedBy: 'user-1',
                modifiedAt: new Date(),
            };

            expect(tag.id).toBe('tag-1');
            expect(tag.label).toBe('Technology');
            expect(tag.color).toBe('#D81B60');
            expect(tag.contentTypeSlug).toBe('articles');
            expect(tag.usageCount).toBe(5);
        });

        it('should have all required IBaseModel fields', () => {
            const tag: ITag = {
                id: 'tag-2',
                label: 'Science',
                color: '#1565C0',
                contentTypeSlug: 'blog-posts',
                usageCount: 0,
                createdBy: 'admin',
                createdAt: new Date('2024-01-01'),
                modifiedBy: 'admin',
                modifiedAt: new Date('2024-01-15'),
            };

            expect(tag.createdBy).toBe('admin');
            expect(tag.createdAt).toBeInstanceOf(Date);
            expect(tag.modifiedBy).toBe('admin');
            expect(tag.modifiedAt).toBeInstanceOf(Date);
        });

        it('should allow zero usage count', () => {
            const tag: ITag = {
                id: 'tag-3',
                label: 'New Tag',
                color: '#2E7D32',
                contentTypeSlug: 'news',
                usageCount: 0,
                createdBy: 'user',
                createdAt: new Date(),
                modifiedBy: 'user',
                modifiedAt: new Date(),
            };

            expect(tag.usageCount).toBe(0);
        });
    });

    describe('TagData Type', () => {
        it('should omit common fields from ITag', () => {
            // TagData should not require createdBy, createdAt, modifiedBy, modifiedAt
            const tagData: TagData = {
                id: 'tag-4',
                label: 'Sports',
                color: '#E65100',
                contentTypeSlug: 'articles',
                usageCount: 10,
            };

            expect(tagData.label).toBe('Sports');
            expect(tagData.color).toBe('#E65100');
        });
    });

    describe('COMPONENT_NAME Constant', () => {
        it('should have correct component name', () => {
            expect(COMPONENT_NAME).toBe('Tags');
        });
    });

    describe('getTagsCollectionName', () => {
        it('should generate correct collection name for articles', () => {
            expect(getTagsCollectionName('articles')).toBe('Tags_articles');
        });

        it('should generate correct collection name for blog-posts', () => {
            expect(getTagsCollectionName('blog-posts')).toBe('Tags_blog-posts');
        });

        it('should handle empty slug', () => {
            expect(getTagsCollectionName('')).toBe('Tags_');
        });

        it('should handle slugs with special characters', () => {
            expect(getTagsCollectionName('my_content')).toBe('Tags_my_content');
        });
    });

    describe('Color Values', () => {
        it('should accept valid hex color codes', () => {
            const tag: ITag = {
                id: 'tag-5',
                label: 'Test',
                color: '#FFFFFF',
                contentTypeSlug: 'test',
                usageCount: 0,
                createdBy: 'user',
                createdAt: new Date(),
                modifiedBy: 'user',
                modifiedAt: new Date(),
            };

            expect(tag.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        });
    });
});
