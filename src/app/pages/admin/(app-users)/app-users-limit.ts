import type { TranslationKey } from '../../../core/i18n/translation-keys';

/**
 * How many host documents ArcCMS reads for the App users page and for App users
 * (live) lists. Mirrors MAX_APP_USERS in functions/src/app-audience/listAppUsers.ts.
 * Past it, people are left out, and every place that uses a live list says so
 * (review C2) until reading every document is built.
 */
export const MAX_APP_USERS = 2000;

/**
 * The warning shown wherever a live list reached the limit, in the admin's language:
 * `{{ APP_USERS_LIMIT_NOTE_KEY | transloco: APP_USERS_LIMIT_PARAMS }}`.
 */
export const APP_USERS_LIMIT_NOTE_KEY: TranslationKey = 'admin.app_users.limit_note';
export const APP_USERS_LIMIT_PARAMS = { max: MAX_APP_USERS.toLocaleString('en') };

