/**
 * Tests for Base Model
 * 
 * Tests verify the base model interface and utility functions.
 */

import { describe, it, expect } from 'vitest';
import {
    IBaseModel,
    OmitCommonFields,
    generateCommonFields,
    updateCommonFields,
} from './base-model';

describe('Base Model', () => {
    describe('IBaseModel Interface', () => {
        it('should create an object conforming to IBaseModel', () => {
            const now = new Date();
            const model: IBaseModel = {
                id: 'test-id',
                createdBy: 'user-1',
                createdAt: now,
                modifiedBy: 'user-2',
                modifiedAt: now,
            };

            expect(model.id).toBe('test-id');
            expect(model.createdBy).toBe('user-1');
            expect(model.createdAt).toBe(now);
            expect(model.modifiedBy).toBe('user-2');
            expect(model.modifiedAt).toBe(now);
        });

        it('should have all required fields', () => {
            const now = new Date();
            const model: IBaseModel = {
                id: '123',
                createdBy: 'user',
                createdAt: now,
                modifiedBy: 'user',
                modifiedAt: now,
            };

            expect(model).toHaveProperty('id');
            expect(model).toHaveProperty('createdBy');
            expect(model).toHaveProperty('createdAt');
            expect(model).toHaveProperty('modifiedBy');
            expect(model).toHaveProperty('modifiedAt');
        });
    });

    describe('OmitCommonFields Type', () => {
        interface TestModel extends IBaseModel {
            name: string;
            email: string;
        }

        it('should omit base model fields from extended interface', () => {
            // This is a compile-time test - if it compiles, the type works
            const partialData: OmitCommonFields<TestModel> = {
                name: 'John',
                email: 'john@example.com',
            };

            expect(partialData.name).toBe('John');
            expect(partialData.email).toBe('john@example.com');
            // id, createdBy, createdAt, modifiedBy, modifiedAt should not be present
            expect(partialData).not.toHaveProperty('id');
            expect(partialData).not.toHaveProperty('createdBy');
        });
    });

    describe('generateCommonFields', () => {
        it('should generate common fields with user ID', () => {
            const userId = 'user-123';
            const fields = generateCommonFields(userId);

            expect(fields.createdBy).toBe(userId);
            expect(fields.modifiedBy).toBe(userId);
            expect(fields.createdAt).toBeInstanceOf(Date);
            expect(fields.modifiedAt).toBeInstanceOf(Date);
        });

        it('should set createdAt and modifiedAt to same time', () => {
            const fields = generateCommonFields('user');

            // Both dates should be approximately the same (within 1 second)
            const diff = Math.abs(fields.createdAt.getTime() - fields.modifiedAt.getTime());
            expect(diff).toBeLessThan(1000);
        });

        it('should not include id field', () => {
            const fields = generateCommonFields('user');

            expect(fields).not.toHaveProperty('id');
        });

        it('should generate current timestamp', () => {
            const before = new Date();
            const fields = generateCommonFields('user');
            const after = new Date();

            expect(fields.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(fields.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
        });
    });

    describe('updateCommonFields', () => {
        it('should generate update fields with user ID', () => {
            const userId = 'user-456';
            const fields = updateCommonFields(userId);

            expect(fields.modifiedBy).toBe(userId);
            expect(fields.modifiedAt).toBeInstanceOf(Date);
        });

        it('should only include modifiedBy and modifiedAt', () => {
            const fields = updateCommonFields('user');

            expect(Object.keys(fields)).toHaveLength(2);
            expect(fields).toHaveProperty('modifiedBy');
            expect(fields).toHaveProperty('modifiedAt');
        });

        it('should not include createdBy or createdAt', () => {
            const fields = updateCommonFields('user');

            expect(fields).not.toHaveProperty('createdBy');
            expect(fields).not.toHaveProperty('createdAt');
            expect(fields).not.toHaveProperty('id');
        });

        it('should generate current timestamp', () => {
            const before = new Date();
            const fields = updateCommonFields('user');
            const after = new Date();

            expect(fields.modifiedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(fields.modifiedAt.getTime()).toBeLessThanOrEqual(after.getTime());
        });
    });
});
