/**
 * Tests for Auth Model
 * 
 * Tests verify the auth model interface structure.
 */

import { describe, it, expect } from 'vitest';
import { IAuth, COMPONENT_NAME } from './auth.model';
import { IBaseModel } from '../../../shared/models/base-model';

describe('Auth Model', () => {
    describe('IAuth Interface', () => {
        it('should extend IBaseModel', () => {
            const now = new Date();
            const auth: IAuth = {
                // IBaseModel fields
                id: 'auth-id',
                createdBy: 'system',
                createdAt: now,
                modifiedBy: 'system',
                modifiedAt: now,
                // IAuth specific fields
                email: 'test@example.com',
                name: 'Test User',
                emailVerified: true,
                status: 'Active',
                uid: 'firebase-uid-123',
                isActive: true,
            };

            // Verify IBaseModel fields
            expect(auth.id).toBe('auth-id');
            expect(auth.createdBy).toBe('system');
            expect(auth.createdAt).toBe(now);

            // Verify IAuth specific fields
            expect(auth.email).toBe('test@example.com');
            expect(auth.name).toBe('Test User');
            expect(auth.uid).toBe('firebase-uid-123');
        });

        it('should have all required fields', () => {
            const auth: IAuth = {
                id: '1',
                createdBy: 'user',
                createdAt: new Date(),
                modifiedBy: 'user',
                modifiedAt: new Date(),
                email: 'user@test.com',
                name: 'User',
                emailVerified: false,
                status: 'Pending',
                uid: 'uid-1',
                isActive: false,
            };

            expect(auth).toHaveProperty('id');
            expect(auth).toHaveProperty('email');
            expect(auth).toHaveProperty('name');
            expect(auth).toHaveProperty('emailVerified');
            expect(auth).toHaveProperty('status');
            expect(auth).toHaveProperty('uid');
            expect(auth).toHaveProperty('isActive');
        });

        it('should allow optional fields to be undefined', () => {
            const auth: IAuth = {
                id: '1',
                createdBy: 'user',
                createdAt: new Date(),
                modifiedBy: 'user',
                modifiedAt: new Date(),
                email: 'user@test.com',
                name: 'User',
                emailVerified: false,
                status: 'Active',
                uid: 'uid-1',
                isActive: true,
                // Optional fields not set
            };

            expect(auth.password).toBeUndefined();
            expect(auth.role).toBeUndefined();
            expect(auth.photo).toBeUndefined();
        });

        it('should allow setting optional fields', () => {
            const auth: IAuth = {
                id: '1',
                createdBy: 'user',
                createdAt: new Date(),
                modifiedBy: 'user',
                modifiedAt: new Date(),
                email: 'user@test.com',
                name: 'User',
                emailVerified: true,
                status: 'Active',
                uid: 'uid-1',
                isActive: true,
                password: 'hashedPassword',
                role: 'admin',
                photo: 'https://example.com/photo.jpg',
            };

            expect(auth.password).toBe('hashedPassword');
            expect(auth.role).toBe('admin');
            expect(auth.photo).toBe('https://example.com/photo.jpg');
        });
    });

    describe('Status Values', () => {
        it('should accept Active status', () => {
            const auth: IAuth = createMinimalAuth('Active');
            expect(auth.status).toBe('Active');
        });

        it('should accept Disable status', () => {
            const auth: IAuth = createMinimalAuth('Disable');
            expect(auth.status).toBe('Disable');
        });

        it('should accept Pending status', () => {
            const auth: IAuth = createMinimalAuth('Pending');
            expect(auth.status).toBe('Pending');
        });
    });

    describe('COMPONENT_NAME Constant', () => {
        it('should be defined', () => {
            expect(COMPONENT_NAME).toBeDefined();
        });

        it('should equal "Auth"', () => {
            expect(COMPONENT_NAME).toBe('Auth');
        });

        it('should be a string', () => {
            expect(typeof COMPONENT_NAME).toBe('string');
        });
    });
});

// Helper function to create minimal auth object
function createMinimalAuth(status: string): IAuth {
    return {
        id: '1',
        createdBy: 'user',
        createdAt: new Date(),
        modifiedBy: 'user',
        modifiedAt: new Date(),
        email: 'test@example.com',
        name: 'Test',
        emailVerified: false,
        status,
        uid: 'uid-1',
        isActive: true,
    };
}
