/**
 * Tests for Generic Store Service
 * 
 * Tests verify the generic store factory function and state management.
 */

import { describe, it, expect } from 'vitest';
import {
    GenericState,
    getDefaultInitialState,
    createGenericStore,
} from './generic-store.service';
import { IBaseModel } from '../models/base-model';

// Test model extending IBaseModel
interface TestModel extends IBaseModel {
    name: string;
    value: number;
}

describe('Generic Store Service', () => {
    describe('GenericState Interface', () => {
        it('should define all required state properties', () => {
            const state: GenericState<TestModel> = {
                currentItem: {} as TestModel,
                items: [],
                isLoading: false,
                isSuccess: false,
                error: '',
                query: '',
                sortField: '',
                order: 'desc',
                totalRecords: 0,
                totalPages: 0,
                previousPageNumber: -1,
                currentPageNumber: 0,
                limit: 10,
                firstVisible: null,
                lastVisible: null,
                whereConditions: [],
                orConditions: [],
            };

            expect(state).toHaveProperty('currentItem');
            expect(state).toHaveProperty('items');
            expect(state).toHaveProperty('isLoading');
            expect(state).toHaveProperty('isSuccess');
            expect(state).toHaveProperty('error');
            expect(state).toHaveProperty('query');
            expect(state).toHaveProperty('sortField');
            expect(state).toHaveProperty('order');
            expect(state).toHaveProperty('totalRecords');
            expect(state).toHaveProperty('totalPages');
            expect(state).toHaveProperty('previousPageNumber');
            expect(state).toHaveProperty('currentPageNumber');
            expect(state).toHaveProperty('limit');
            expect(state).toHaveProperty('firstVisible');
            expect(state).toHaveProperty('lastVisible');
            expect(state).toHaveProperty('whereConditions');
            expect(state).toHaveProperty('orConditions');
        });

        it('should allow order to be asc or desc', () => {
            const ascState: GenericState<TestModel> = {
                ...getDefaultInitialState<TestModel>(),
                order: 'asc',
            };
            const descState: GenericState<TestModel> = {
                ...getDefaultInitialState<TestModel>(),
                order: 'desc',
            };

            expect(ascState.order).toBe('asc');
            expect(descState.order).toBe('desc');
        });
    });

    describe('getDefaultInitialState', () => {
        it('should return default initial state', () => {
            const state = getDefaultInitialState<TestModel>();

            expect(state.currentItem).toEqual({});
            expect(state.items).toEqual([]);
            expect(state.isLoading).toBe(false);
            expect(state.isSuccess).toBe(false);
            expect(state.error).toBe('');
            expect(state.query).toBe('');
            expect(state.sortField).toBe('');
            expect(state.order).toBe('desc');
            expect(state.totalRecords).toBe(0);
            expect(state.totalPages).toBe(0);
            expect(state.previousPageNumber).toBe(-1);
            expect(state.currentPageNumber).toBe(0);
            expect(state.limit).toBe(10);
            expect(state.firstVisible).toBeNull();
            expect(state.lastVisible).toBeNull();
            expect(state.whereConditions).toEqual([]);
            expect(state.orConditions).toEqual([]);
        });

        it('should return empty items array', () => {
            const state = getDefaultInitialState<TestModel>();
            expect(Array.isArray(state.items)).toBe(true);
            expect(state.items).toHaveLength(0);
        });

        it('should set default limit to 10', () => {
            const state = getDefaultInitialState<TestModel>();
            expect(state.limit).toBe(10);
        });

        it('should set default order to desc', () => {
            const state = getDefaultInitialState<TestModel>();
            expect(state.order).toBe('desc');
        });
    });

    describe('createGenericStore', () => {
        it('should be defined', () => {
            expect(createGenericStore).toBeDefined();
        });

        it('should be a function', () => {
            expect(typeof createGenericStore).toBe('function');
        });

        it('should accept ServiceType parameter', () => {
            // The function signature accepts a service type
            expect(createGenericStore.length).toBeGreaterThanOrEqual(1);
        });

        it('should accept optional initialState parameter', () => {
            // The function can be called with partial initial state
            expect(createGenericStore.length).toBeLessThanOrEqual(2);
        });
    });

    describe('State Management Properties', () => {
        describe('Loading State', () => {
            it('should track isLoading', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.isLoading).toBe(false);
            });

            it('should track isSuccess', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.isSuccess).toBe(false);
            });

            it('should track error', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.error).toBe('');
            });
        });

        describe('Pagination State', () => {
            it('should track limit', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.limit).toBe(10);
            });

            it('should track currentPageNumber', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.currentPageNumber).toBe(0);
            });

            it('should track previousPageNumber', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.previousPageNumber).toBe(-1);
            });

            it('should track totalRecords', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.totalRecords).toBe(0);
            });

            it('should track totalPages', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.totalPages).toBe(0);
            });
        });

        describe('Query State', () => {
            it('should track query string', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.query).toBe('');
            });

            it('should track sortField', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.sortField).toBe('');
            });

            it('should track whereConditions array', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(Array.isArray(state.whereConditions)).toBe(true);
            });

            it('should track orConditions array', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(Array.isArray(state.orConditions)).toBe(true);
            });
        });

        describe('Cursor State', () => {
            it('should track firstVisible cursor', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.firstVisible).toBeNull();
            });

            it('should track lastVisible cursor', () => {
                const state = getDefaultInitialState<TestModel>();
                expect(state.lastVisible).toBeNull();
            });
        });
    });
});
