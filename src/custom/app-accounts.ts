/**
 * The accounts this app makes with createAppAccount (docs/app/app-accounts.html).
 * Arc CMS ships this empty and never edits it again. Empty means a locked app
 * account may open the member pages (/user/...), where its profile is read-only.
 *
 *   export const CUSTOM_APP_ACCOUNTS: AppAccountChoice = {
 *       memberPages: false,   // send locked app accounts to their home page instead
 *   };
 *
 * Accounts made with `selfService: true` are ordinary members and ignore this.
 */
import type { AppAccountChoice } from '../app/core/app-accounts/app-account-lock';

export const CUSTOM_APP_ACCOUNTS: AppAccountChoice = {};
