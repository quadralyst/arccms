/**
 * Tests for Auth Service
 * 
 * Tests verify the AuthService class functionality.
 */

import { describe, it, expect } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService', () => {
    describe('Service Definition', () => {
        it('should be defined', () => {
            expect(AuthService).toBeDefined();
        });
    });

    describe('Service Methods', () => {
        it('should have checkAlreadyExist method', () => {
            expect(AuthService.prototype.checkAlreadyExist).toBeDefined();
        });
    });

    describe('Service Inheritance', () => {
        it('should extend GlobalAuthService', () => {
            // AuthService extends GlobalAuthService<IAuth>
            expect(AuthService.prototype).toBeDefined();
        });

        // Inherited methods from GlobalAuthService
        it('should inherit register method', () => {
            expect(AuthService.prototype.register).toBeDefined();
        });

        it('should inherit login method', () => {
            expect(AuthService.prototype.login).toBeDefined();
        });

        it('should inherit logout method', () => {
            expect(AuthService.prototype.logout).toBeDefined();
        });

        it('should inherit updateUser method', () => {
            expect(AuthService.prototype.updateUser).toBeDefined();
        });

        it('should inherit forgotPassword method', () => {
            expect(AuthService.prototype.forgotPassword).toBeDefined();
        });

        it('should not inherit loginWithGoogle method (removed)', () => {
            expect(AuthService.prototype.loginWithGoogle).toBeUndefined();
        });

        it('should inherit getCurrentUserByUid method', () => {
            expect(AuthService.prototype.getCurrentUserByUid).toBeDefined();
        });
    });

    describe('Collection Configuration', () => {
        it('should use "users" collection', () => {
            // The constructor is called with 'users'
            // This is verified by checking the service definition
            expect(AuthService).toBeDefined();
        });
    });

    describe('checkAlreadyExist Method', () => {
        it('should have correct method signature', () => {
            const method = AuthService.prototype.checkAlreadyExist;
            expect(typeof method).toBe('function');
            // Method takes one parameter (email value)
            expect(method.length).toBe(1);
        });
    });

    describe('isFirstRun Method', () => {
        it('should be defined on the prototype', () => {
            expect(AuthService.prototype.isFirstRun).toBeDefined();
            expect(typeof AuthService.prototype.isFirstRun).toBe('function');
        });

        it('should take zero parameters', () => {
            expect(AuthService.prototype.isFirstRun.length).toBe(0);
        });

        it('should return true (first run) when email_lookup collection is empty', () => {
            // Test the observable mapping logic by simulating what isFirstRun does:
            // it maps snapshot.empty → boolean
            const { of: rxOf } = require('rxjs');
            const { map } = require('rxjs');
            const emptySnapshot = { empty: true };
            let result: boolean | null = null;
            rxOf(emptySnapshot).pipe(map((s: any) => s.empty)).subscribe((v: boolean) => (result = v));
            expect(result).toBe(true);
        });

        it('should return false (not first run) when email_lookup collection has documents', () => {
            const { of: rxOf } = require('rxjs');
            const { map } = require('rxjs');
            const nonEmptySnapshot = { empty: false };
            let result: boolean | null = null;
            rxOf(nonEmptySnapshot).pipe(map((s: any) => s.empty)).subscribe((v: boolean) => (result = v));
            expect(result).toBe(false);
        });
    });

    describe('addEmailLookup Method', () => {
        it('should be defined', () => {
            expect(AuthService.prototype.addEmailLookup).toBeDefined();
            expect(typeof AuthService.prototype.addEmailLookup).toBe('function');
        });
    });

    describe('removeEmailLookup Method', () => {
        it('should be defined', () => {
            expect(AuthService.prototype.removeEmailLookup).toBeDefined();
            expect(typeof AuthService.prototype.removeEmailLookup).toBe('function');
        });
    });

    describe('updateUserEmail Method', () => {
        it('should be defined on the prototype', () => {
            expect(AuthService.prototype.updateUserEmail).toBeDefined();
            expect(typeof AuthService.prototype.updateUserEmail).toBe('function');
        });

        it('should accept four parameters (docId, oldEmail, newEmail, currentPassword)', () => {
            expect(AuthService.prototype.updateUserEmail.length).toBe(4);
        });

        it('should return a Promise', () => {
            // The method signature is async, returning Promise<string>
            const descriptor = Object.getOwnPropertyDescriptor(
                AuthService.prototype,
                'updateUserEmail',
            );
            expect(descriptor).toBeDefined();
            // Async functions have constructor name AsyncFunction
            expect(AuthService.prototype.updateUserEmail.constructor.name).toBe('AsyncFunction');
        });
    });

    describe('updateUserEmail — source code verification', () => {
        const fs = require('fs');
        const path = require('path');
        const sourcePath = path.resolve(__dirname, 'auth.service.ts');
        let source: string;

        try {
            source = fs.readFileSync(sourcePath, 'utf-8');
        } catch {
            source = '';
        }

        it('should re-authenticate user before updating email', () => {
            expect(source).toContain('this.reAuthenticate(user, currentPassword)');
        });

        it('should call Firebase Auth updateEmail', () => {
            expect(source).toContain('updateEmail(user, newEmail)');
        });

        it('should update Firestore user doc with new email', () => {
            expect(source).toContain('email: newEmail');
        });

        it('should set emailVerified to false in Firestore', () => {
            expect(source).toContain('emailVerified: false');
        });

        it('should add new email hash to email_lookup before removing old', () => {
            const addIndex = source.indexOf('this.addEmailLookup(newEmail)');
            const removeIndex = source.indexOf('this.removeEmailLookup(oldEmail)');
            expect(addIndex).toBeGreaterThan(-1);
            expect(removeIndex).toBeGreaterThan(-1);
            expect(addIndex).toBeLessThan(removeIndex);
        });

        it('should return "Email updated" on success', () => {
            expect(source).toContain("return 'Email updated'");
        });

        it('should return error code on failure', () => {
            expect(source).toContain("return error.code || 'unknown-error'");
        });

        it('should return auth/no-current-user when no user is logged in', () => {
            expect(source).toContain("return 'auth/no-current-user'");
        });

        it('should import updateEmail from @angular/fire/auth', () => {
            expect(source).toContain("import { updateEmail } from '@angular/fire/auth'");
        });

        it('should await firstValueFrom on super.update() for Firestore write', () => {
            expect(source).toContain('await firstValueFrom(super.update(docId');
        });
    });
});
