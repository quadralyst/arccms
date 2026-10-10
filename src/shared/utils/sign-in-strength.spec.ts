/**
 * The app's password and PIN strength (specs/sign-in-strength-spec.md): this file's
 * source is src/shared/utils/sign-in-strength.ts, and
 * functions/src/shared/sign-in-strength.ts its mirror for the server.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveSignInStrength } from './sign-in-strength';
import * as server from '../../../functions/src/shared/sign-in-strength';
import { CUSTOM_SIGN_IN } from '../../custom/sign-in';

describe('resolveSignInStrength', () => {
    it('is strict when the app chose nothing, as Arc CMS ships it', () => {
        expect(resolveSignInStrength(undefined)).toBe('strict');
        expect(resolveSignInStrength({})).toBe('strict');
        expect(resolveSignInStrength(CUSTOM_SIGN_IN)).toBe('strict');
    });

    it('takes the two strengths', () => {
        expect(resolveSignInStrength({ strength: 'simple' })).toBe('simple');
        expect(resolveSignInStrength({ strength: 'strict' })).toBe('strict');
    });

    it('stops the build on anything else, saying what to write', () => {
        for (const strength of ['Simple', 'easy', '', null]) {
            expect(() => resolveSignInStrength({ strength } as never)).toThrow(/src\/custom\/sign-in\.ts.*strength: 'simple'/);
        }
    });

    it('the server copy is this file, line for line after its opening comment', () => {
        const body = (path: string) => readFileSync(resolve(__dirname, path), 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\s*/, '');
        expect(body('../../../functions/src/shared/sign-in-strength.ts')).toBe(body('./sign-in-strength.ts'));
        expect(server.resolveSignInStrength({ strength: 'simple' })).toBe('simple');
    });
});
