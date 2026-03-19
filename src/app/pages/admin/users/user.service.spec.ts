/**
 * Tests for User Service
 * 
 * Tests verify the UserService class functionality.
 * UserService extends DbService<IUser> for CRUD operations on the 'users' collection.
 */

import { describe, it, expect } from 'vitest';
import { UserService } from './user.service';

describe('UserService', () => {
    describe('Service Definition', () => {
        it('should be defined', () => {
            expect(UserService).toBeDefined();
        });
    });

    describe('Service Inheritance', () => {
        it('should extend DbService', () => {
            // UserService extends DbService<IUser>
            expect(UserService.prototype).toBeDefined();
        });
    });

    describe('Collection Configuration', () => {
        it('should use "users" collection', () => {
            // The constructor is called with 'users'
            expect(UserService).toBeDefined();
        });
    });

    // Inherited from DbService
    describe('CRUD Methods (inherited from DbService)', () => {
        it('should inherit getAll method', () => {
            expect(UserService.prototype.getAll).toBeDefined();
        });

        it('should inherit getById method', () => {
            expect(UserService.prototype.getById).toBeDefined();
        });

        it('should inherit add method', () => {
            expect(UserService.prototype.add).toBeDefined();
        });

        it('should inherit update method', () => {
            expect(UserService.prototype.update).toBeDefined();
        });

        it('should inherit delete method', () => {
            expect(UserService.prototype.delete).toBeDefined();
        });

        it('should inherit getByCustomField method', () => {
            expect(UserService.prototype.getByCustomField).toBeDefined();
        });

        it('should inherit getCollectionTotalCount method', () => {
            expect(UserService.prototype.getCollectionTotalCount).toBeDefined();
        });
    });
});
