/**
 * The first admin always gets the strict password rule, even in an app that chose
 * simple passwords (src/custom/sign-in.ts, specs/sign-in-strength-spec.md SS-D7).
 */
import { describe, it, expect, vi } from 'vitest';
import { FormBuilder } from '@angular/forms';

vi.mock('../../core/sign-in/sign-in-strength', () => ({ SIGN_IN_STRENGTH: 'simple' }));

import OnboardingComponent from './onboarding.page';

describe('OnboardingComponent: the first admin\'s password', () => {
    function form() {
        const proto = OnboardingComponent.prototype as any;
        const page: any = {
            fb: new FormBuilder(),
            passwordMatchValidator: proto.passwordMatchValidator,
            emailMatchValidator: proto.emailMatchValidator,
        };
        proto.initForm.call(page);
        page.onboardingForm.patchValue({ name: 'Asha Rao', email: 'asha@example.com' });
        return { page, password: page.onboardingForm.get('password'), passwordError: () => proto.passwordError.call(page) };
    }

    it('refuses a password the simple rule would take, saying the strict length', () => {
        const { password, passwordError } = form();
        password.setValue('abc123');
        expect(password.errors).toEqual({ password: 'short' });
        expect(passwordError()).toBe('Use at least 8 characters.');
        password.setValue('12345678');
        expect(password.errors).toEqual({ password: 'sequence' });
        password.setValue('Monsoon-Train-42');
        expect(password.errors).toBeNull();
    });
});
