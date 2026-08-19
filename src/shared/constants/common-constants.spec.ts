/**
 * Tests for ConstantVariables class
 * 
 * These tests verify that all constant values are correctly defined
 * and maintain their expected structure.
 */

import { describe, it, expect } from 'vitest';
import { ConstantVariables } from './common-constants';

describe('ConstantVariables', () => {
    let constants: ConstantVariables;

    beforeEach(() => {
        constants = new ConstantVariables();
    });

    describe('Basic Constants', () => {
        it('should have correct PAGINATION_LIMIT', () => {
            expect(constants.PAGINATION_LIMIT).toBe(10);
        });

        it('should have correct APPLICATION_NAME', () => {
            expect(constants.APPLICATION_NAME).toBe('Arc CMS');
        });

    });

    describe('Role Constants', () => {
        it('should have correct ADMIN value', () => {
            expect(constants.ADMIN).toBe('admin');
        });

        it('should have correct USER value', () => {
            expect(constants.USER).toBe('user');
        });

        it('should have correct CUSTOMER value', () => {
            expect(constants.CUSTOMER).toBe('customer');
        });
    });

    describe('Status Constants', () => {
        it('should have correct PUBLISH value', () => {
            expect(constants.PUBLISH).toBe('publish');
        });

        it('should have correct DRAFT value', () => {
            expect(constants.DRAFT).toBe('draft');
        });

        it('should have correct REFINE value', () => {
            expect(constants.REFINE).toBe('refinePrompt');
        });

        it('should have correct FETCH_CONTENT value', () => {
            expect(constants.FETCH_CONTENT).toBe('fetchContent');
        });
    });

    describe('Roles Arrays', () => {
        it('should have fixedRoles with admin and customer', () => {
            expect(constants.fixedRoles).toHaveLength(2);
            expect(constants.fixedRoles[0].userType).toBe('admin');
            expect(constants.fixedRoles[1].userType).toBe('customer');
        });

        it('should have roles array matching fixedRoles', () => {
            expect(constants.roles).toHaveLength(2);
            expect(constants.roles).toEqual([...constants.fixedRoles]);
        });

        it('should have correct role labels', () => {
            const adminRole = constants.roles.find(r => r.userType === 'admin');
            expect(adminRole?.userTypeLabel).toBe('Admin');
        });
    });

    describe('Media Manager Menu', () => {
        it('should have three menu items', () => {
            expect(constants.mediaManagerMenu).toHaveLength(3);
        });

        it('should have an icons menu item', () => {
            const iconsItem = constants.mediaManagerMenu.find((m: any) => m.value === 'icons');
            expect(iconsItem).toBeDefined();
            expect(iconsItem.name).toBe('Icons');
        });

        it('should tag every tab with the kind of result it produces', () => {
            // The dialog hides tabs whose kind the caller cannot accept, so an
            // untagged tab would show up in a picker that has no use for it.
            expect(constants.mediaManagerMenu.map((m: any) => [m.value, m.kind])).toEqual([
                ['upload', 'image'],
                ['search', 'image'],
                ['icons', 'icon'],
            ]);
        });

        it('should have upload menu item', () => {
            const uploadItem = constants.mediaManagerMenu.find((m: any) => m.value === 'upload');
            expect(uploadItem).toBeDefined();
            expect(uploadItem.name).toBe('My Uploads');
            expect(uploadItem.icon).toBe('upload');
        });

        it('should have search menu item', () => {
            const searchItem = constants.mediaManagerMenu.find((m: any) => m.value === 'search');
            expect(searchItem).toBeDefined();
            expect(searchItem.name).toBe('Free Images');
            expect(searchItem.icon).toBe('image');
        });
    });

    describe('Firebase Auth Errors', () => {
        it('should have firebaseAuthErrors array', () => {
            expect(Array.isArray(constants.firebaseAuthErrors)).toBe(true);
            expect(constants.firebaseAuthErrors.length).toBeGreaterThan(0);
        });

        it('should have correct structure for auth errors', () => {
            const firstError = constants.firebaseAuthErrors[0];
            expect(firstError).toHaveProperty('code');
            expect(firstError).toHaveProperty('message');
        });

        it('should include common error codes', () => {
            const errorCodes = constants.firebaseAuthErrors.map(e => e.code);
            expect(errorCodes).toContain('auth/email-already-in-use');
            expect(errorCodes).toContain('auth/invalid-email');
            expect(errorCodes).toContain('auth/wrong-password');
            expect(errorCodes).toContain('auth/user-not-found');
        });
    });

    describe('Tags Color Options', () => {
        it('should have tagsColorOptions array', () => {
            expect(Array.isArray(constants.tagsColorOptions)).toBe(true);
            expect(constants.tagsColorOptions.length).toBe(20);
        });

        it('should have correct structure for color options', () => {
            const firstColor = constants.tagsColorOptions[0];
            expect(firstColor).toHaveProperty('color');
            expect(firstColor).toHaveProperty('title');
        });

        it('should have valid hex colors', () => {
            constants.tagsColorOptions.forEach(option => {
                expect(option.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
            });
        });
    });

    describe('Default Email Tags', () => {
        it('should have default email tags', () => {
            expect(constants.defaultEmailTags).toContain('##OTP##');
            expect(constants.defaultEmailTags).toContain('##RECEIVER_NAME##');
            expect(constants.defaultEmailTags).toContain('##COMPANY_NAME##');
        });
    });

    describe('Cron Job Status', () => {
        it('should have all cron job statuses', () => {
            expect(constants.CRON_JOB_STATUS.EXECUTED).toBe('executed');
            expect(constants.CRON_JOB_STATUS.ERROR).toBe('error');
            expect(constants.CRON_JOB_STATUS.PENDING).toBe('pending');
        });
    });

    describe('Email Send Status', () => {
        it('should have all email send statuses', () => {
            expect(constants.EMAIL_SEND_STATUS.QUEUED).toBe('QUEUED');
            expect(constants.EMAIL_SEND_STATUS.SENT).toBe('SENT');
            expect(constants.EMAIL_SEND_STATUS.DELIVERED).toBe('DELIVERED');
            expect(constants.EMAIL_SEND_STATUS.SOFT_BOUNCE).toBe('SOFT_BOUNCE');
            expect(constants.EMAIL_SEND_STATUS.HARD_BOUNCE).toBe('HARD_BOUNCE');
            expect(constants.EMAIL_SEND_STATUS.OPENED).toBe('OPENED');
            expect(constants.EMAIL_SEND_STATUS.NOT_OPENED).toBe('NOT OPENED');
            expect(constants.EMAIL_SEND_STATUS.CLICKED).toBe('CLICKED');
            expect(constants.EMAIL_SEND_STATUS.COMPLAINT).toBe('COMPLAINT');
            expect(constants.EMAIL_SEND_STATUS.FAILED).toBe('FAILED');
        });
    });

    describe('Default System Instruction', () => {
        it('should have a default system instruction', () => {
            expect(constants.defaultSystemInstruction).toBeDefined();
            expect(typeof constants.defaultSystemInstruction).toBe('string');
            expect(constants.defaultSystemInstruction.length).toBeGreaterThan(0);
        });
    });
});
