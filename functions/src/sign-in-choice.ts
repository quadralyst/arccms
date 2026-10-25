/**
 * The strength this app chose for new passwords and PINs (src/custom/sign-in.ts,
 * specs/sign-in-strength-spec.md), and the sign-in choices it fixed (email PIN
 * sign-in, the new-device code; specs/sign-in-pin-spec.md). SIGN_IN_STRENGTH and
 * SIGN_IN_FIXED are generated from that file by scripts/arc-features.mjs before
 * every build and test run.
 */
import { SIGN_IN_FIXED, SIGN_IN_STRENGTH } from './sign-in.gen.js';
import type { FixedSignIn, SignInStrength } from './shared/sign-in-strength.js';

export function signInStrength(): SignInStrength {
    return SIGN_IN_STRENGTH;
}

/** The sign-in choices the app fixed; `null` where the admin's setting decides. */
export function fixedSignIn(): FixedSignIn {
    return SIGN_IN_FIXED;
}
