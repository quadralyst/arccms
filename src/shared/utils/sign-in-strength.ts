/**
 * How hard new passwords and PINs must be (specs/sign-in-strength-spec.md), chosen
 * by the app in src/custom/sign-in.ts at build time:
 *
 * - `strict`, the default: passwords of 8 characters or more that are not
 *   repeated, a run, common or personal (password-rule.ts), and PINs that are not
 *   repeated digits, a run or a common pattern;
 * - `simple`, for casual apps: passwords of 6 characters or more, any 6-digit PIN.
 *
 * Only new passwords and PINs are checked, in both modes. Lockouts, rate limits and
 * PIN hashing never change.
 *
 * Source of truth; functions/src/shared/sign-in-strength.ts is a mirror for the
 * Cloud Functions build, which cannot import from src/. sign-in-strength.spec.ts
 * checks the two agree.
 */

export const SIGN_IN_STRENGTHS = ['strict', 'simple'] as const;

export type SignInStrength = (typeof SIGN_IN_STRENGTHS)[number];

/** What an app puts in src/custom/sign-in.ts. */
export interface SignInChoice {
    /** `simple` for casual apps; nothing (or `strict`) for the full rule. */
    strength?: SignInStrength;
}

/** The strength an app chose; a value that is not one stops the build with what to write. */
export function resolveSignInStrength(choice: SignInChoice | undefined): SignInStrength {
    const strength = choice?.strength;
    if (strength === undefined) return 'strict';
    if ((SIGN_IN_STRENGTHS as readonly unknown[]).includes(strength)) return strength;
    throw new Error(
        `src/custom/sign-in.ts: strength is ${JSON.stringify(strength)}. Write strength: 'simple' for casual apps, ` +
            `or leave it out (or write 'strict') for the full password and PIN rule.`,
    );
}
