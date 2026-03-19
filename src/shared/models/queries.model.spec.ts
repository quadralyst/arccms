/**
 * Tests for Query Models
 * 
 * These tests verify that the query model interfaces and types
 * are correctly structured at compile time and runtime.
 */

import { describe, it, expect } from 'vitest';
import type {
    PaginationType,
    OrderByDirection,
    WhereCondition,
    QueryParams
} from './queries.model';

describe('Query Models', () => {
    describe('PaginationType', () => {
        it('should accept "Prev" as valid value', () => {
            const paginationType: PaginationType = 'Prev';
            expect(paginationType).toBe('Prev');
        });

        it('should accept "Next" as valid value', () => {
            const paginationType: PaginationType = 'Next';
            expect(paginationType).toBe('Next');
        });
    });

    describe('OrderByDirection', () => {
        it('should accept "asc" as valid value', () => {
            const direction: OrderByDirection = 'asc';
            expect(direction).toBe('asc');
        });

        it('should accept "desc" as valid value', () => {
            const direction: OrderByDirection = 'desc';
            expect(direction).toBe('desc');
        });
    });

    describe('WhereCondition', () => {
        it('should create a valid WhereCondition with == operator', () => {
            const condition: WhereCondition = {
                field: 'status',
                operator: '==',
                value: 'active',
            };
            expect(condition.field).toBe('status');
            expect(condition.operator).toBe('==');
            expect(condition.value).toBe('active');
        });

        it('should accept all valid operators', () => {
            const operators: WhereCondition['operator'][] = [
                '<', '<=', '==', '!=', '>=', '>',
                'array-contains', 'in', 'array-contains-any', 'not-in'
            ];

            operators.forEach(op => {
                const condition: WhereCondition = {
                    field: 'test',
                    operator: op,
                    value: 'value',
                };
                expect(condition.operator).toBe(op);
            });
        });

        it('should accept any value type', () => {
            const stringCondition: WhereCondition = {
                field: 'name',
                operator: '==',
                value: 'test',
            };

            const numberCondition: WhereCondition = {
                field: 'age',
                operator: '>',
                value: 18,
            };

            const arrayCondition: WhereCondition = {
                field: 'tags',
                operator: 'in',
                value: ['tag1', 'tag2'],
            };

            expect(stringCondition.value).toBe('test');
            expect(numberCondition.value).toBe(18);
            expect(arrayCondition.value).toEqual(['tag1', 'tag2']);
        });
    });

    describe('QueryParams', () => {
        it('should create a valid QueryParams with required fields', () => {
            const params: QueryParams = {
                limitCount: 10,
                currentPageNumber: 1,
                previousPageNumber: 0,
            };

            expect(params.limitCount).toBe(10);
            expect(params.currentPageNumber).toBe(1);
            expect(params.previousPageNumber).toBe(0);
        });

        it('should accept optional whereConditions', () => {
            const params: QueryParams = {
                limitCount: 10,
                currentPageNumber: 1,
                previousPageNumber: 0,
                whereConditions: [
                    { field: 'status', operator: '==', value: 'active' },
                ],
            };

            expect(params.whereConditions).toHaveLength(1);
            expect(params.whereConditions?.[0].field).toBe('status');
        });

        it('should accept optional orConditions', () => {
            const params: QueryParams = {
                limitCount: 10,
                currentPageNumber: 1,
                previousPageNumber: 0,
                orConditions: [
                    { field: 'role', operator: '==', value: 'admin' },
                    { field: 'role', operator: '==', value: 'user' },
                ],
            };

            expect(params.orConditions).toHaveLength(2);
        });

        it('should accept optional orderBy fields', () => {
            const params: QueryParams = {
                limitCount: 10,
                currentPageNumber: 1,
                previousPageNumber: 0,
                orderByField: 'createdAt',
                orderByDirection: 'desc',
            };

            expect(params.orderByField).toBe('createdAt');
            expect(params.orderByDirection).toBe('desc');
        });

        it('should accept optional pagination documents', () => {
            const mockDoc = { id: 'doc123' };
            const params: QueryParams = {
                limitCount: 10,
                currentPageNumber: 2,
                previousPageNumber: 1,
                startAfterDoc: mockDoc,
                endBeforeDoc: null,
            };

            expect(params.startAfterDoc).toBe(mockDoc);
            expect(params.endBeforeDoc).toBeNull();
        });

        it('should accept optional getOnce flag', () => {
            const params: QueryParams = {
                limitCount: 10,
                currentPageNumber: 1,
                previousPageNumber: 0,
                getOnce: true,
            };

            expect(params.getOnce).toBe(true);
        });

        it('should create complete QueryParams with all fields', () => {
            const params: QueryParams = {
                whereConditions: [{ field: 'status', operator: '==', value: 'active' }],
                orConditions: [{ field: 'type', operator: '==', value: 'blog' }],
                orderByField: 'createdAt',
                orderByDirection: 'desc',
                limitCount: 20,
                currentPageNumber: 3,
                previousPageNumber: 2,
                endBeforeDoc: null,
                startAfterDoc: { id: 'doc5' },
                getOnce: false,
            };

            expect(params.limitCount).toBe(20);
            expect(params.whereConditions).toBeDefined();
            expect(params.orConditions).toBeDefined();
            expect(params.orderByField).toBe('createdAt');
        });
    });
});
