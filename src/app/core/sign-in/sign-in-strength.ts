/**
 * The strength this app chose for new passwords and PINs (src/custom/sign-in.ts,
 * specs/sign-in-strength-spec.md), and the sign-in choices it fixed (email PIN
 * sign-in, the new-device code; specs/sign-in-pin-spec.md). The functions read
 * the same choices from functions/src/sign-in.gen.ts, which scripts/arc-features.mjs writes.
 */
import { CUSTOM_SIGN_IN } from '../../../custom/sign-in';
import { resolveFixedSignIn, resolveSignInStrength, type FixedSignIn, type SignInStrength } from '../../../shared/utils/sign-in-strength';

export const SIGN_IN_STRENGTH: SignInStrength = resolveSignInStrength(CUSTOM_SIGN_IN);

/** The sign-in choices the app fixed; `null` where the admin chooses in Settings, User Settings. */
export const SIGN_IN_FIXED: FixedSignIn = resolveFixedSignIn(CUSTOM_SIGN_IN);
