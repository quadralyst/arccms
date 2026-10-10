/**
 * The new-password validator follows the app's strength (src/custom/sign-in.ts,
 * specs/sign-in-strength-spec.md): here the app chose simple.
 */
import { describe, it, expect, vi } from 'vitest';
import { FormControl } from '@angular/forms';

vi.mock('../../app/core/sign-in/sign-in-strength', () => ({ SIGN_IN_STRENGTH: 'simple' }));

import { newPasswordValidator, passwordProblemOf } from './password-validator';

const errorsFor = (value: string, strength?: 'strict' | 'simple') => {
    const control = new FormControl(value, strength ? newPasswordValidator(() => ({ name: 'Asha Rao' }), strength) : newPasswordValidator(() => ({ name: 'Asha Rao' })));
    return passwordProblemOf(control);
};

describe('newPasswordValidator', () => {
    it('takes the app\'s simple rule when the field names none', () => {
        expect(errorsFor('abc12')).toBe('short');
        expect(errorsFor('abc123')).toBeNull();
        expect(errorsFor('asha1234')).toBeNull();
    });

    it('keeps the strict rule where the field asks for it (onboarding, the first admin)', () => {
        expect(errorsFor('abc123', 'strict')).toBe('short');
        expect(errorsFor('12345678', 'strict')).toBe('sequence');
        expect(errorsFor('asha1234', 'strict')).toBe('personal');
    });

    it('leaves an empty field to required', () => {
        expect(errorsFor('')).toBeNull();
    });
});
