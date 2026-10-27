/**
 * What the sign-in page tells the app (docs/app/sign-in.html#page-hooks). Arc CMS ships
 * this empty and never edits it again. Empty means nothing is called.
 *
 *   export const CUSTOM_SIGN_IN_PAGE: SignInPageHooks = {
 *       signingUp: ({ warm }) => warm(['createWorkspace']),
 *   };
 *
 * `warm` starts the app's own functions while the person is still typing.
 */
import type { SignInPageHooks } from '../app/core/sign-in/page-hooks';

export const CUSTOM_SIGN_IN_PAGE: SignInPageHooks = {};
