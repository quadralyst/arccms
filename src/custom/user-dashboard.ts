/**
 * The page a signed-in member lands on, /user/dashboard (docs/custom-code.md).
 * Arc CMS ships this empty, showing its own blank dashboard, and never edits it
 * again. To show the app's own page there instead:
 *
 *   export const CUSTOM_USER_DASHBOARD: UserDashboardLoader = () =>
 *       import('./pages/my-dashboard').then((m) => m.default);
 *
 * Wrap the page in <app-user-shell> to keep the member menu.
 */
import type { Type } from '@angular/core';

export type UserDashboardLoader = () => Promise<Type<unknown>>;

export const CUSTOM_USER_DASHBOARD: UserDashboardLoader | null = null;
