/**
 * Mirror of src/shared/utils/sign-in-strength.ts (the source of truth) for the
 * Cloud Functions build, which cannot import from src/. Keep in sync by hand;
 * src/shared/utils/sign-in-strength.spec.ts checks the two agree. The app's choice
 * reaches the functions through sign-in.gen.ts (../sign-in-choice.ts).
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
