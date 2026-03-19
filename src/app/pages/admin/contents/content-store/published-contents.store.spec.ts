import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentsStore } from './published-contents.store';
import { ContentsService } from './published-contents.service';
import { AuthState } from '../../../(auth)/auth.store';

describe('ContentsStore', () => {
    let store: ContentsStore;

    const mockService = {
        collectionName: 'Contents',
        getAll: vi.fn(),
        getById: vi.fn(),
        add: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    };

    const mockAuthStore = {
        currentUser: vi.fn().mockReturnValue({ id: 'test-user-123' })
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                ContentsStore,
                { provide: ContentsService, useValue: mockService },
                { provide: AuthState, useValue: mockAuthStore }
            ]
        });
        store = TestBed.inject(ContentsStore);
    });

    it('should be created', () => {
        expect(store).toBeTruthy();
    });

    it('should be injectable', () => {
        expect(store).toBeInstanceOf(ContentsStore);
    });

    describe('Store State', () => {
        it('should have items signal', () => {
            expect(store.items).toBeDefined();
            expect(typeof store.items).toBe('function');
        });

        it('should have isLoading signal', () => {
            expect(store.isLoading).toBeDefined();
            expect(typeof store.isLoading).toBe('function');
        });

        it('should have currentItem signal', () => {
            expect(store.currentItem).toBeDefined();
            expect(typeof store.currentItem).toBe('function');
        });

        it('should have totalRecords signal', () => {
            expect(store.totalRecords).toBeDefined();
            expect(typeof store.totalRecords).toBe('function');
        });
    });

    describe('Store Methods', () => {
        it('should have getAll method', () => {
            expect(store.getAll).toBeDefined();
            expect(typeof store.getAll).toBe('function');
        });

        it('should have getById method', () => {
            expect(store.getById).toBeDefined();
            expect(typeof store.getById).toBe('function');
        });

        it('should have add method', () => {
            expect(store.add).toBeDefined();
            expect(typeof store.add).toBe('function');
        });

        it('should have update method', () => {
            expect(store.update).toBeDefined();
            expect(typeof store.update).toBe('function');
        });

        it('should have delete method', () => {
            expect(store.delete).toBeDefined();
            expect(typeof store.delete).toBe('function');
        });
    });

    describe('Initial State', () => {
        it('should start with empty items array', () => {
            expect(store.items()).toEqual([]);
        });

        it('should start with isLoading false', () => {
            expect(store.isLoading()).toBe(false);
        });

        it('should start with empty currentItem object', () => {
            expect(store.currentItem()).toEqual({});
        });

        it('should start with totalRecords as 0', () => {
            expect(store.totalRecords()).toBe(0);
        });
    });
});
