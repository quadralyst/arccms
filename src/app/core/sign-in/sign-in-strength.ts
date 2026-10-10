/**
 * The strength this app chose for new passwords and PINs (src/custom/sign-in.ts,
 * specs/sign-in-strength-spec.md). The functions read the same choice from
 * functions/src/sign-in.gen.ts, which scripts/arc-features.mjs writes.
 */
import { CUSTOM_SIGN_IN } from '../../../custom/sign-in';
import { resolveSignInStrength, type SignInStrength } from '../../../shared/utils/sign-in-strength';

export const SIGN_IN_STRENGTH: SignInStrength = resolveSignInStrength(CUSTOM_SIGN_IN);
