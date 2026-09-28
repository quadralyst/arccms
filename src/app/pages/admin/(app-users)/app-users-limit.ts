/**
 * How many host documents ArcCMS reads for the App users page and for App users
 * (live) lists. Mirrors MAX_APP_USERS in functions/src/app-audience/listAppUsers.ts.
 * Past it, people are left out, and every place that uses a live list says so
 * (review C2) until reading every document is built.
 */
export const MAX_APP_USERS = 2000;

/** The warning shown wherever a live list reached the limit. */
export const APP_USERS_LIMIT_NOTE =
    `Only the first ${MAX_APP_USERS.toLocaleString('en')} users in your app are checked. Anyone after them is left out.`;
