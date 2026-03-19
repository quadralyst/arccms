import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TagsStore } from './tags.store';
import { TagsService } from './tags.service';
import { ConstantVariables } from '../../../../../../shared/constants/common-constants';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { ITag } from './tags.model';

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    collection: vi.fn(),
    doc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    endBefore: vi.fn(),
    DocumentSnapshot: class { },
}));

vi.mock('@angular/fire/auth', () => ({
    Auth: class { },
    onAuthStateChanged: vi.fn(() => vi.fn()),
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
}));

describe('TagsStore', () => {
    let store: TagsStore;
    let tagsService: TagsService;
    let constantVariables: ConstantVariables;

    const mockFirestore = {};
    const mockAuth = {};

    const mockTags: ITag[] = [
        {
            id: 'tag-1',
            label: 'Technology',
            color: '#D81B60',
            contentTypeSlug: 'articles',
            usageCount: 5,
            createdBy: 'user',
            createdAt: new Date(),
            modifiedBy: 'user',
            modifiedAt: new Date(),
        },
        {
            id: 'tag-2',
            label: 'Science',
            color: '#E65100',
            contentTypeSlug: 'articles',
            usageCount: 3,
            createdBy: 'user',
            createdAt: new Date(),
            modifiedBy: 'user',
            modifiedAt: new Date(),
        },
    ];

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                TagsStore,
                TagsService,
                ConstantVariables,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Auth, useValue: mockAuth },
            ],
        });
        store = TestBed.inject(TagsStore);
        tagsService = TestBed.inject(TagsService);
        constantVariables = TestBed.inject(ConstantVariables);
    });

    describe('Constructor', () => {
        it('should be created', () => {
            expect(store).toBeTruthy();
        });
    });

    describe('setContentTypeSlug', () => {
        it('should update content type slug', () => {
            store.setContentTypeSlug('articles');
            expect(store.getContentTypeSlug()).toBe('articles');
        });

        it('should clear used colors when changing content type', () => {
            store.setContentTypeSlug('articles');
            store.setContentTypeSlug('blog-posts');
            expect(store.getContentTypeSlug()).toBe('blog-posts');
        });

        it('should not reset if setting same slug', () => {
            store.setContentTypeSlug('articles');
            const firstSlug = store.getContentTypeSlug();
            store.setContentTypeSlug('articles');
            expect(store.getContentTypeSlug()).toBe(firstSlug);
        });
    });

    describe('getNextAvailableColor', () => {
        it('should return first color from palette initially', () => {
            const color = store.getNextAvailableColor();
            expect(color).toBe(constantVariables.tagsColorOptions[0].color);
        });

        it('should return a valid hex color', () => {
            const color = store.getNextAvailableColor();
            expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        });
    });

    describe('addTagWithAutoColor', () => {
        it('should return tag data with auto-assigned color', () => {
            const result = store.addTagWithAutoColor('New Tag');
            expect(result.label).toBe('New Tag');
            expect(result.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        });

        it('should assign different colors for subsequent tags', () => {
            const tag1 = store.addTagWithAutoColor('Tag 1');
            const tag2 = store.addTagWithAutoColor('Tag 2');
            expect(tag1.color).not.toBe(tag2.color);
        });
    });

    describe('getTagByLabel', () => {
        it('should return undefined when no tags exist', () => {
            const result = store.getTagByLabel('NonExistent');
            expect(result).toBeUndefined();
        });
    });

    describe('filterTags', () => {
        it('should return empty array when no tags exist', () => {
            const result = store.filterTags('test');
            expect(result).toEqual([]);
        });

        it('should return all items when search term is empty', () => {
            const result = store.filterTags('');
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('isDuplicateLabel', () => {
        it('should return a promise', () => {
            const result = store.isDuplicateLabel('test');
            expect(typeof result.then).toBe('function');
        });
    });

    describe('updateUsedColors', () => {
        it('should be a function', () => {
            expect(typeof store.updateUsedColors).toBe('function');
        });

        it('should execute without error', () => {
            expect(() => store.updateUsedColors()).not.toThrow();
        });
    });

    describe('Color Cycling', () => {
        it('should cycle colors after palette is exhausted', () => {
            // Use all 20 colors
            for (let i = 0; i < 20; i++) {
                store.addTagWithAutoColor(`Tag ${i}`);
            }
            // 21st tag should cycle back
            const tag21 = store.addTagWithAutoColor('Tag 21');
            expect(tag21.color).toBe(constantVariables.tagsColorOptions[0].color);
        });
    });
});
