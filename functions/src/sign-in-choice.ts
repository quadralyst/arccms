/**
 * The strength this app chose for new passwords and PINs (src/custom/sign-in.ts,
 * specs/sign-in-strength-spec.md). SIGN_IN_STRENGTH is generated from that file by
 * scripts/arc-features.mjs before every build and test run.
 */
import { SIGN_IN_STRENGTH } from './sign-in.gen.js';
import type { SignInStrength } from './shared/sign-in-strength.js';

export function signInStrength(): SignInStrength {
    return SIGN_IN_STRENGTH;
}
