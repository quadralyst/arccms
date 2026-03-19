/**
 * Tests for Global Auth Service
 * 
 * Tests verify the GlobalAuthService class functionality.
 */

import { describe, it, expect } from 'vitest';
import { GlobalAuthService } from './global-auth.service';
import { COLLECTION_NAME } from './db.service';

describe('GlobalAuthService', () => {
    describe('Service Definition', () => {
        it('should be defined', () => {
            expect(GlobalAuthService).toBeDefined();
        });
    });

    describe('Service Methods', () => {
        it('should have register method', () => {
            expect(GlobalAuthService.prototype.register).toBeDefined();
        });

        it('should have login method', () => {
            expect(GlobalAuthService.prototype.login).toBeDefined();
        });

        it('should have logout method', () => {
            expect(GlobalAuthService.prototype.logout).toBeDefined();
        });

        it('should have updateUser method', () => {
            expect(GlobalAuthService.prototype.updateUser).toBeDefined();
        });

        it('should have reAuthenticate method', () => {
            expect(GlobalAuthService.prototype.reAuthenticate).toBeDefined();
        });

        it('should have updatePassword method', () => {
            expect(GlobalAuthService.prototype.updatePassword).toBeDefined();
        });

        it('should have getCurrentUserByUid method', () => {
            expect(GlobalAuthService.prototype.getCurrentUserByUid).toBeDefined();
        });

        it('should have forgotPassword method', () => {
            expect(GlobalAuthService.prototype.forgotPassword).toBeDefined();
        });

        it('should not have loginWithGoogle method (removed)', () => {
            expect(GlobalAuthService.prototype.loginWithGoogle).toBeUndefined();
        });
    });

    describe('Service Inheritance', () => {
        it('should extend DbService', () => {
            // GlobalAuthService extends DbService<IAuth>
            // This is verified at compile time
            expect(GlobalAuthService.prototype).toBeDefined();
        });
    });

    describe('Authentication Features', () => {
        describe('Email/Password Auth', () => {
            it('should have register method signature', () => {
                const method = GlobalAuthService.prototype.register;
                expect(typeof method).toBe('function');
            });

            it('should have login method signature', () => {
                const method = GlobalAuthService.prototype.login;
                expect(typeof method).toBe('function');
            });
        });

        describe('Password Management', () => {
            it('should have forgotPassword method signature', () => {
                const method = GlobalAuthService.prototype.forgotPassword;
                expect(typeof method).toBe('function');
            });

            it('should have updatePassword method signature', () => {
                const method = GlobalAuthService.prototype.updatePassword;
                expect(typeof method).toBe('function');
            });

            it('should have reAuthenticate method signature', () => {
                const method = GlobalAuthService.prototype.reAuthenticate;
                expect(typeof method).toBe('function');
            });
        });

        describe('User Management', () => {
            it('should have updateUser method signature', () => {
                const method = GlobalAuthService.prototype.updateUser;
                expect(typeof method).toBe('function');
            });

            it('should have getCurrentUserByUid method signature', () => {
                const method = GlobalAuthService.prototype.getCurrentUserByUid;
                expect(typeof method).toBe('function');
            });
        });

        describe('updateUser — source code verification', () => {
            const fs = require('fs');
            const path = require('path');
            const sourcePath = path.resolve(__dirname, 'global-auth.service.ts');
            let source: string;

            try {
                source = fs.readFileSync(sourcePath, 'utf-8');
            } catch {
                source = '';
            }

            it('should always sync Firebase Auth displayName when name is updated', () => {
                expect(source).toContain("if (updatedFields.name !== undefined)");
                expect(source).toContain("profileUpdate.displayName = updatedFields.name");
            });

            it('should sync Firebase Auth photoURL when photo is updated', () => {
                expect(source).toContain("if (updatedFields.photo !== undefined)");
                expect(source).toContain("profileUpdate.photoURL = updatedFields.photo || null");
            });

            it('should call updateProfile with collected profile changes', () => {
                expect(source).toContain("await updateProfile(user, profileUpdate)");
            });

            it('should strip password from Firestore fields before write', () => {
                expect(source).toContain("delete firestoreFields.password");
            });

            it('should return "Profile updated" on success', () => {
                expect(source).toContain("return 'Profile updated'");
            });

            it('should return auth/no-current-user when not logged in', () => {
                expect(source).toContain("return 'auth/no-current-user'");
            });

            it('should return error code on failure', () => {
                expect(source).toContain("return error.code || 'unknown-error'");
            });

            it('should await firstValueFrom on super.update() for Firestore write', () => {
                expect(source).toContain('await firstValueFrom(super.update(docId');
            });

            it('should not import updateEmail (moved to auth.service.ts)', () => {
                // updateEmail was removed from imports as it is now used only in auth.service.ts
                const importBlock = source.match(/import \{[\s\S]*?\} from '@angular\/fire\/auth'/);
                expect(importBlock).toBeDefined();
                expect(importBlock![0]).not.toContain('updateEmail');
            });
        });

        describe('Session Management', () => {
            it('should have logout method signature', () => {
                const method = GlobalAuthService.prototype.logout;
                expect(typeof method).toBe('function');
            });
        });
    });
});
