/**
 * What the sign-in page tells the app as a person moves through it
 * (docs/app/sign-in.html#page-hooks), from src/custom/sign-in-page.ts. The app uses it
 * to start the functions it will call next, so their cold start is paid while the
 * person is still typing.
 */

/** What a hook is given. */
export interface SignInPageMoment {
    /**
     * Start the app's own callable functions (functions/src/custom), by the name they
     * are exported with: each gets a `{ warmUp: true }` call, which a function answers
     * at once with `isWarmUp()` from the app kit. Never waits, never fails, and asks a
     * function at most once every 5 minutes.
     */
    warm(names: readonly string[]): void;
    /** How the person is signing in or up, once the page knows. */
    channel?: 'email' | 'phone';
}

/** What an app puts in src/custom/sign-in-page.ts. Each hook is optional and must return at once. */
export interface SignInPageHooks {
    /** The page has opened for someone who is not signed in. */
    opened?(moment: SignInPageMoment): void;
    /**
     * A new account is under way: its code was sent, or its name and password or PIN
     * are being asked. Start what the app calls just after a sign-up.
     */
    signingUp?(moment: SignInPageMoment): void;
}

/** Run a hook, so a mistake in the app's hook never stops the sign-in page. */
export function runPageHook(hook: ((moment: SignInPageMoment) => void) | undefined, moment: SignInPageMoment): void {
    if (!hook) return;
    try {
        hook(moment);
    } catch (err) {
        console.error('src/custom/sign-in-page.ts: a hook failed', err);
    }
}
