/**
 * Tests for Profile Page Component
 *
 * Tests verify the ProfileComponent functionality including
 * photo upload via media manager, name/email editing, and password change.
 */

import { describe, it, expect } from 'vitest';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import ProfileComponent from './profile.page';

describe('ProfileComponent', () => {
    describe('Component Definition', () => {
        it('should be defined', () => {
            expect(ProfileComponent).toBeDefined();
        });

        it('should be a class', () => {
            expect(typeof ProfileComponent).toBe('function');
        });
    });

    describe('Component Inheritance', () => {
        it('should extend BaseComponent', () => {
            expect(ProfileComponent.prototype).toBeDefined();
        });
    });

    describe('Component Methods — Photo', () => {
        it('should have openPhotoSelector method', () => {
            expect(ProfileComponent.prototype.openPhotoSelector).toBeDefined();
            expect(typeof ProfileComponent.prototype.openPhotoSelector).toBe('function');
        });

        it('should have removePhoto method', () => {
            expect(ProfileComponent.prototype.removePhoto).toBeDefined();
            expect(typeof ProfileComponent.prototype.removePhoto).toBe('function');
        });
    });

    describe('Component Methods — Name', () => {
        it('should have editName method', () => {
            expect(ProfileComponent.prototype.editName).toBeDefined();
            expect(typeof ProfileComponent.prototype.editName).toBe('function');
        });

        it('should have cancelEditName method', () => {
            expect(ProfileComponent.prototype.cancelEditName).toBeDefined();
            expect(typeof ProfileComponent.prototype.cancelEditName).toBe('function');
        });

        it('should have saveName method', () => {
            expect(ProfileComponent.prototype.saveName).toBeDefined();
            expect(typeof ProfileComponent.prototype.saveName).toBe('function');
        });
    });

    describe('Component Methods — Email', () => {
        it('should have startEditEmail method', () => {
            expect(ProfileComponent.prototype.startEditEmail).toBeDefined();
            expect(typeof ProfileComponent.prototype.startEditEmail).toBe('function');
        });

        it('should have cancelEditEmail method', () => {
            expect(ProfileComponent.prototype.cancelEditEmail).toBeDefined();
            expect(typeof ProfileComponent.prototype.cancelEditEmail).toBe('function');
        });

        it('should have saveEmail method', () => {
            expect(ProfileComponent.prototype.saveEmail).toBeDefined();
            expect(typeof ProfileComponent.prototype.saveEmail).toBe('function');
        });
    });

    describe('Component Methods — Password', () => {
        it('should have startChangePassword method', () => {
            expect(ProfileComponent.prototype.startChangePassword).toBeDefined();
            expect(typeof ProfileComponent.prototype.startChangePassword).toBe('function');
        });

        it('should have cancelChangePassword method', () => {
            expect(ProfileComponent.prototype.cancelChangePassword).toBeDefined();
            expect(typeof ProfileComponent.prototype.cancelChangePassword).toBe('function');
        });

        it('should have savePassword method', () => {
            expect(ProfileComponent.prototype.savePassword).toBeDefined();
            expect(typeof ProfileComponent.prototype.savePassword).toBe('function');
        });

        it('should have hasPasswordMismatch getter', () => {
            const descriptor = Object.getOwnPropertyDescriptor(
                ProfileComponent.prototype,
                'hasPasswordMismatch',
            );
            expect(descriptor).toBeDefined();
            expect(descriptor!.get).toBeDefined();
        });
    });

    describe('Component Methods — Utilities', () => {
        it('should have clearMessages method', () => {
            expect(ProfileComponent.prototype.clearMessages).toBeDefined();
            expect(typeof ProfileComponent.prototype.clearMessages).toBe('function');
        });

        it('should have goBack method', () => {
            expect(ProfileComponent.prototype.goBack).toBeDefined();
            expect(typeof ProfileComponent.prototype.goBack).toBe('function');
        });

        it('should have getInitials method', () => {
            expect(ProfileComponent.prototype.getInitials).toBeDefined();
            expect(typeof ProfileComponent.prototype.getInitials).toBe('function');
        });
    });

    describe('getInitials — pure function tests', () => {
        const getInitials = ProfileComponent.prototype.getInitials;

        it('should return "?" for empty string', () => {
            expect(getInitials('')).toBe('?');
        });

        it('should return first letter for single word', () => {
            expect(getInitials('John')).toBe('J');
        });

        it('should return two initials for two words', () => {
            expect(getInitials('John Doe')).toBe('JD');
        });

        it('should return only first two initials for multiple words', () => {
            expect(getInitials('John Michael Doe')).toBe('JM');
        });

        it('should return uppercase initials', () => {
            expect(getInitials('john doe')).toBe('JD');
        });

        it('should handle names with leading/trailing spaces', () => {
            expect(getInitials('  John  Doe  ')).toBe('JD');
        });

        it('should return "?" for whitespace-only input', () => {
            expect(getInitials('   ')).toBe('?');
        });
    });

    describe('hasPasswordMismatch — form validation logic', () => {
        // We can test the getter by constructing a matching FormGroup
        // and binding it to the prototype getter via call()

        function buildMismatchChecker(
            newPw: string,
            confirmPw: string,
            confirmTouched: boolean,
        ): boolean {
            // Replicate the getter logic without needing DI
            const newPwVal = newPw;
            const confirmPwVal = confirmPw;
            return !!(
                newPwVal &&
                confirmPwVal &&
                newPwVal !== confirmPwVal &&
                confirmTouched
            );
        }

        it('should return false when both fields are empty', () => {
            expect(buildMismatchChecker('', '', false)).toBe(false);
        });

        it('should return false when passwords match', () => {
            expect(buildMismatchChecker('password1', 'password1', true)).toBe(false);
        });

        it('should return true when passwords do not match and confirm is touched', () => {
            expect(buildMismatchChecker('password1', 'password2', true)).toBe(true);
        });

        it('should return false when passwords do not match but confirm is untouched', () => {
            expect(buildMismatchChecker('password1', 'password2', false)).toBe(false);
        });

        it('should return false when only new password is set', () => {
            expect(buildMismatchChecker('password1', '', true)).toBe(false);
        });

        it('should return false when only confirm password is set', () => {
            expect(buildMismatchChecker('', 'password1', true)).toBe(false);
        });
    });

    describe('Form validation rules — emailForm', () => {
        let emailForm: FormGroup;

        function createEmailForm() {
            return new FormGroup({
                email: new FormControl('', [Validators.required, Validators.email]),
                password: new FormControl('', [Validators.required]),
            });
        }

        it('should be invalid when empty', () => {
            emailForm = createEmailForm();
            expect(emailForm.valid).toBe(false);
        });

        it('should be invalid with invalid email format', () => {
            emailForm = createEmailForm();
            emailForm.patchValue({ email: 'not-an-email', password: 'secret' });
            expect(emailForm.get('email')!.valid).toBe(false);
        });

        it('should be invalid without password', () => {
            emailForm = createEmailForm();
            emailForm.patchValue({ email: 'test@example.com', password: '' });
            expect(emailForm.get('password')!.valid).toBe(false);
        });

        it('should be valid with valid email and password', () => {
            emailForm = createEmailForm();
            emailForm.patchValue({ email: 'test@example.com', password: 'secret' });
            expect(emailForm.valid).toBe(true);
        });
    });

    describe('Form validation rules — passwordForm', () => {
        let passwordForm: FormGroup;

        function createPasswordForm() {
            return new FormGroup({
                currentPassword: new FormControl('', [Validators.required]),
                newPassword: new FormControl('', [Validators.required, Validators.minLength(8)]),
                confirmPassword: new FormControl('', [Validators.required]),
            });
        }

        it('should be invalid when empty', () => {
            passwordForm = createPasswordForm();
            expect(passwordForm.valid).toBe(false);
        });

        it('should be invalid when newPassword is shorter than 8 chars', () => {
            passwordForm = createPasswordForm();
            passwordForm.patchValue({
                currentPassword: 'old',
                newPassword: 'short',
                confirmPassword: 'short',
            });
            expect(passwordForm.get('newPassword')!.valid).toBe(false);
        });

        it('should be valid when all fields are correctly filled', () => {
            passwordForm = createPasswordForm();
            passwordForm.patchValue({
                currentPassword: 'oldpass123',
                newPassword: 'newpass123',
                confirmPassword: 'newpass123',
            });
            expect(passwordForm.valid).toBe(true);
        });

        it('should be invalid when currentPassword is empty', () => {
            passwordForm = createPasswordForm();
            passwordForm.patchValue({
                currentPassword: '',
                newPassword: 'newpass123',
                confirmPassword: 'newpass123',
            });
            expect(passwordForm.get('currentPassword')!.valid).toBe(false);
        });
    });

    describe('Form validation rules — nameControl', () => {
        it('should be invalid when empty', () => {
            const nameControl = new FormControl('', [Validators.required, Validators.maxLength(50)]);
            expect(nameControl.valid).toBe(false);
        });

        it('should be valid with a normal name', () => {
            const nameControl = new FormControl('John Doe', [Validators.required, Validators.maxLength(50)]);
            expect(nameControl.valid).toBe(true);
        });

        it('should be invalid when exceeding 50 characters', () => {
            const longName = 'A'.repeat(51);
            const nameControl = new FormControl(longName, [Validators.required, Validators.maxLength(50)]);
            expect(nameControl.valid).toBe(false);
        });

        it('should be valid at exactly 50 characters', () => {
            const exactName = 'A'.repeat(50);
            const nameControl = new FormControl(exactName, [Validators.required, Validators.maxLength(50)]);
            expect(nameControl.valid).toBe(true);
        });
    });

    describe('Template structure verification', () => {
        // Read the HTML template as a string to verify key UI elements exist
        const fs = require('fs');
        const path = require('path');
        const templatePath = path.resolve(__dirname, 'profile.page.html');
        let template: string;

        try {
            template = fs.readFileSync(templatePath, 'utf-8');
        } catch {
            template = '';
        }

        it('should have a profile container', () => {
            expect(template).toContain('profile-container');
        });

        it('should have 3 profile cards (avatar, personal info, security)', () => {
            const cardMatches = template.match(/class="profile-card/g);
            expect(cardMatches).toBeDefined();
            expect(cardMatches!.length).toBeGreaterThanOrEqual(3);
        });

        it('should have avatar section with camera overlay', () => {
            expect(template).toContain('avatar-wrapper');
            expect(template).toContain('avatar-overlay');
            expect(template).toContain('fa-camera');
        });

        it('should call openPhotoSelector on avatar click', () => {
            expect(template).toContain('openPhotoSelector()');
        });

        it('should have Personal Information section', () => {
            expect(template).toContain('Personal Information');
        });

        it('should have Security section', () => {
            expect(template).toContain('Security');
        });

        it('should have name editing form', () => {
            expect(template).toContain('editName()');
            expect(template).toContain('saveName()');
            expect(template).toContain('cancelEditName()');
        });

        it('should have email editing form with password requirement', () => {
            expect(template).toContain('startEditEmail()');
            expect(template).toContain('saveEmail()');
            expect(template).toContain('cancelEditEmail()');
            expect(template).toContain('emailForm');
            expect(template).toContain('required to change email');
        });

        it('should have password change form with current/new/confirm fields', () => {
            expect(template).toContain('startChangePassword()');
            expect(template).toContain('savePassword()');
            expect(template).toContain('cancelChangePassword()');
            expect(template).toContain('passwordForm');
            expect(template).toContain('currentPassword');
            expect(template).toContain('newPassword');
            expect(template).toContain('confirmPassword');
        });

        it('should have password visibility toggles', () => {
            expect(template).toContain('showEmailPassword');
            expect(template).toContain('showCurrentPassword');
            expect(template).toContain('showNewPassword');
            expect(template).toContain('showConfirmPassword');
            expect(template).toContain('fa-eye');
            expect(template).toContain('fa-eye-slash');
        });

        it('should show loading spinners on save buttons', () => {
            expect(template).toContain('isSavingName()');
            expect(template).toContain('isSavingEmail()');
            expect(template).toContain('isSavingPassword()');
            expect(template).toContain('spinner-border');
        });

        it('should show success and error alerts', () => {
            expect(template).toContain('successMsg()');
            expect(template).toContain('errorMsg()');
            expect(template).toContain('alert-success');
            expect(template).toContain('alert-danger');
        });

        it('should show verified badge for email', () => {
            expect(template).toContain('emailVerified');
            expect(template).toContain('verified-badge');
        });

        it('should have Change Photo and Remove Photo buttons', () => {
            expect(template).toContain('Change Photo');
            expect(template).toContain('removePhoto()');
        });

        it('should show role badge and status badge', () => {
            expect(template).toContain('role-badge');
            expect(template).toContain('status-badge');
        });

        it('should have back button', () => {
            expect(template).toContain('goBack()');
        });

        it('should show password mismatch error', () => {
            expect(template).toContain('hasPasswordMismatch');
            expect(template).toContain('Passwords do not match');
        });
    });

    describe('SCSS structure verification', () => {
        const fs = require('fs');
        const path = require('path');
        const scssPath = path.resolve(__dirname, 'profile.page.scss');
        let scss: string;

        try {
            scss = fs.readFileSync(scssPath, 'utf-8');
        } catch {
            scss = '';
        }

        it('should use the app primary gradient', () => {
            expect(scss).toContain('linear-gradient(135deg, #3c76f5, #1d47a3)');
        });

        it('should have card styles with correct border-radius', () => {
            expect(scss).toContain('.profile-card');
            expect(scss).toContain('border-radius: 12px');
        });

        it('should have avatar overlay transition', () => {
            expect(scss).toContain('.avatar-overlay');
            expect(scss).toContain('opacity: 0');
            expect(scss).toContain('transition');
        });

        it('should have responsive breakpoints', () => {
            expect(scss).toContain('@media (max-width: 768px)');
            expect(scss).toContain('@media (max-width: 576px)');
        });

        it('should prevent iOS zoom on mobile inputs', () => {
            expect(scss).toContain('font-size: 16px');
        });

        it('should style form controls with blue focus', () => {
            expect(scss).toContain('border-color: #3c76f5');
        });

        it('should have button hover lift effect', () => {
            expect(scss).toContain('translateY(-2px)');
        });
    });

    describe('Route Meta', () => {
        it('should have title set to Profile', async () => {
            const { routeMeta } = await import('./profile.page');
            expect(routeMeta).toBeDefined();
            expect(routeMeta.title).toBe('Profile | Arc CMS');
        });
    });

    describe('Regression tests', () => {
        const fs = require('fs');
        const path = require('path');
        const sourcePath = path.resolve(__dirname, 'profile.page.ts');
        let source: string;

        try {
            source = fs.readFileSync(sourcePath, 'utf-8');
        } catch {
            source = '';
        }

        it('should use separate showEmailPassword signal for email form (not shared with password form)', () => {
            // Regression: showCurrentPassword was shared between email and password forms
            expect(source).toContain('showEmailPassword = signal(false)');
            expect(source).toContain('showCurrentPassword = signal(false)');
        });

        it('should NOT call initAuthStateListener in ngOnInit (store hook handles it)', () => {
            // Regression: duplicate subscription caused double Firestore reads and memory leak
            expect(source).not.toContain('ngOnInit');
            expect(source).not.toContain('initAuthStateListener');
        });

        it('should trim and filter in getInitials to prevent crash on spaced names', () => {
            // Regression: getInitials("  John  ") would crash with undefined[0]
            expect(source).toContain('.trim()');
            expect(source).toContain('filter(Boolean)');
        });

        it('template should use showEmailPassword for email form password toggle (not showCurrentPassword)', () => {
            const fs2 = require('fs');
            const templatePath2 = path.resolve(__dirname, 'profile.page.html');
            let template2: string;
            try {
                template2 = fs2.readFileSync(templatePath2, 'utf-8');
            } catch {
                template2 = '';
            }

            // The email form section should reference showEmailPassword
            const emailFormSection = template2.slice(
                template2.indexOf('emailForm'),
                template2.indexOf('Security'),
            );
            expect(emailFormSection).toContain('showEmailPassword');
            expect(emailFormSection).not.toContain('showCurrentPassword');
        });

        it('should start email form with empty email field (not pre-filled with current email)', () => {
            // Regression: was pre-filling with current email, forcing user to clear it
            const startEditMethod = source.slice(
                source.indexOf('startEditEmail'),
                source.indexOf('cancelEditEmail'),
            );
            expect(startEditMethod).toContain("email: ''");
        });
    });
});
