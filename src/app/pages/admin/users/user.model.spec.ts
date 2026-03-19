/**
 * Tests for User Model
 * 
 * Tests verify the user model interface structure.
 */

import { describe, it, expect } from 'vitest';
import { IUser, UserFormData, COMPONENT_NAME } from './user.model';
import { UserRole, UserStatus } from '../../../../shared/components/base/base.component';
import { IBaseModel } from '../../../../shared/models/base-model';

describe('User Model', () => {
    describe('IUser Interface', () => {
        it('should extend IBaseModel', () => {
            const now = new Date();
            const user: IUser = {
                // IBaseModel fields
                id: 'user-id',
                createdBy: 'system',
                createdAt: now,
                modifiedBy: 'system',
                modifiedAt: now,
                // IUser specific fields
                email: 'test@example.com',
                name: 'Test User',
                emailVerified: true,
                status: UserStatus.Active,
                role: UserRole.Admin,
                isActive: true,
                uid: 'firebase-uid-123',
            };

            // Verify IBaseModel fields
            expect(user.id).toBe('user-id');
            expect(user.createdBy).toBe('system');
            expect(user.createdAt).toBe(now);

            // Verify IUser specific fields
            expect(user.email).toBe('test@example.com');
            expect(user.name).toBe('Test User');
            expect(user.uid).toBe('firebase-uid-123');
        });

        it('should have all required fields', () => {
            const user: IUser = createMinimalUser();

            expect(user).toHaveProperty('id');
            expect(user).toHaveProperty('email');
            expect(user).toHaveProperty('name');
            expect(user).toHaveProperty('emailVerified');
            expect(user).toHaveProperty('status');
            expect(user).toHaveProperty('role');
            expect(user).toHaveProperty('isActive');
            expect(user).toHaveProperty('uid');
        });

        it('should allow optional fields to be undefined', () => {
            const user: IUser = createMinimalUser();

            expect(user.firstName).toBeUndefined();
            expect(user.lastName).toBeUndefined();
            expect(user.password).toBeUndefined();
            expect(user.photo).toBeUndefined();
            expect(user.isOnBoardingComplete).toBeUndefined();
        });

        it('should allow setting optional fields', () => {
            const user: IUser = {
                ...createMinimalUser(),
                firstName: 'John',
                lastName: 'Doe',
                photo: 'https://example.com/photo.jpg',
                isOnBoardingComplete: true,
            };

            expect(user.firstName).toBe('John');
            expect(user.lastName).toBe('Doe');
            expect(user.photo).toBe('https://example.com/photo.jpg');
            expect(user.isOnBoardingComplete).toBe(true);
        });
    });

    describe('UserStatus Values', () => {
        it('should accept Active status', () => {
            const user: IUser = {
                ...createMinimalUser(),
                status: UserStatus.Active,
            };
            expect(user.status).toBe(UserStatus.Active);
        });

        it('should accept Inactive status', () => {
            const user: IUser = {
                ...createMinimalUser(),
                status: UserStatus.Inactive,
            };
            expect(user.status).toBe(UserStatus.Inactive);
        });

        it('should accept Pending status', () => {
            const user: IUser = {
                ...createMinimalUser(),
                status: UserStatus.Pending,
            };
            expect(user.status).toBe(UserStatus.Pending);
        });
    });

    describe('UserRole Values', () => {
        it('should accept Admin role', () => {
            const user: IUser = {
                ...createMinimalUser(),
                role: UserRole.Admin,
            };
            expect(user.role).toBe(UserRole.Admin);
        });

        it('should accept User role', () => {
            const user: IUser = {
                ...createMinimalUser(),
                role: UserRole.User,
            };
            expect(user.role).toBe(UserRole.User);
        });

        it('should accept Customer role', () => {
            const user: IUser = {
                ...createMinimalUser(),
                role: UserRole.Customer,
            };
            expect(user.role).toBe(UserRole.Customer);
        });
    });

    describe('UserFormData Type', () => {
        it('should omit base model fields', () => {
            // This is a compile-time test
            const formData: UserFormData = {
                email: 'test@example.com',
                name: 'Test',
                emailVerified: false,
                status: UserStatus.Pending,
                role: UserRole.User,
                isActive: false,
                uid: 'uid-1',
            };

            expect(formData.email).toBe('test@example.com');
            expect(formData.name).toBe('Test');
            expect(formData).not.toHaveProperty('id');
            expect(formData).not.toHaveProperty('createdBy');
        });
    });

    describe('COMPONENT_NAME Constant', () => {
        it('should be defined', () => {
            expect(COMPONENT_NAME).toBeDefined();
        });

        it('should equal "Users"', () => {
            expect(COMPONENT_NAME).toBe('Users');
        });

        it('should be a string', () => {
            expect(typeof COMPONENT_NAME).toBe('string');
        });
    });
});

// Helper function to create minimal user object
function createMinimalUser(): IUser {
    return {
        id: '1',
        createdBy: 'system',
        createdAt: new Date(),
        modifiedBy: 'system',
        modifiedAt: new Date(),
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: false,
        status: UserStatus.Active,
        role: UserRole.User,
        isActive: true,
        uid: 'uid-1',
    };
}
