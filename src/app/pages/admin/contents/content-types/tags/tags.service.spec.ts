import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TagsService } from './tags.service';
import { getTagsCollectionName } from './tags.model';
import { Firestore } from '@angular/fire/firestore';

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    collection: vi.fn(() => ({})),
    doc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    endBefore: vi.fn(),
    DocumentSnapshot: class { },
    CollectionReference: class { },
}));

describe('TagsService', () => {
    let service: TagsService;

    const mockFirestore = {};

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                TagsService,
                { provide: Firestore, useValue: mockFirestore },
            ],
        });
        service = TestBed.inject(TagsService);
    });

    describe('Constructor', () => {
        it('should be created', () => {
            expect(service).toBeTruthy();
        });
    });

    describe('setContentTypeSlug', () => {
        it('should update currentContentTypeSlug signal', () => {
            service.setContentTypeSlug('news');
            expect(service.getContentTypeSlug()).toBe('news');
        });

        it('should handle different slugs', () => {
            service.setContentTypeSlug('articles');
            expect(service.getContentTypeSlug()).toBe('articles');
            service.setContentTypeSlug('blog-posts');
            expect(service.getContentTypeSlug()).toBe('blog-posts');
        });
    });

    describe('getContentTypeSlug', () => {
        it('should return empty string initially', () => {
            expect(service.getContentTypeSlug()).toBe('');
        });

        it('should return the currently set slug', () => {
            service.setContentTypeSlug('products');
            expect(service.getContentTypeSlug()).toBe('products');
        });
    });

    describe('checkDuplicateLabel', () => {
        it('should be a function', () => {
            expect(typeof service.checkDuplicateLabel).toBe('function');
        });
    });

    describe('Collection Name Helper', () => {
        it('getTagsCollectionName should format correctly', () => {
            expect(getTagsCollectionName('articles')).toBe('Tags_articles');
            expect(getTagsCollectionName('blog-posts')).toBe('Tags_blog-posts');
        });
    });
});

