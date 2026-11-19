/**
 * What a person may do to their own account on the profile page, chosen by the app in
 * src/custom/own-account.ts at build time (docs/app/member-area.html#own-account). The
 * functions read the same choice from functions/src/own-account.gen.ts, which
 * scripts/arc-features.mjs writes with resolveOwnAccount.
 */

/** What an app puts in src/custom/own-account.ts. Leave a choice out and it is allowed. */
export interface OwnAccountChoice {
    /** `false`: no Delete my account on the profile page, and deleteMyAccount refuses (`self-delete-off`). */
    selfDelete?: boolean;
    /**
     * `false`: an email or number that is on another account is refused, with its own
     * reason (`on-another-account`), never moved here. The profile page, linkEmail and
     * linkPhone all refuse it.
     */
    moveIdentifiers?: boolean;
}

/** The choice with every field decided. */
export interface OwnAccount {
    selfDelete: boolean;
    moveIdentifiers: boolean;
}

/** The app's choice, each field `true` unless it wrote `false`; a value that is not one stops the build with what to write. */
export function resolveOwnAccount(choice: OwnAccountChoice | undefined): OwnAccount {
    const read = (key: keyof OwnAccountChoice): boolean => {
        const value = choice?.[key];
        if (value === undefined) return true;
        if (typeof value === 'boolean') return value;
        throw new Error(`src/custom/own-account.ts: ${key} is ${JSON.stringify(value)}. Write ${key}: false, or leave it out to allow it.`);
    };
    return { selfDelete: read('selfDelete'), moveIdentifiers: read('moveIdentifiers') };
}
