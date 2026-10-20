/**
 * The app's own email templates, and its wording of core's account emails in the
 * languages it adds (docs/app/app-email.html). Arc CMS ships this empty and never
 * edits it again.
 *
 * APP_EMAIL_TEMPLATES are the templates sendAppEmail sends, each with a subject and
 * body per language. ACCOUNT_EMAIL_LANGUAGES words the sign-up and password reset
 * code emails in a language other than English. A mistake here stops the functions
 * from loading, so the deploy fails with the reason.
 */
import type { AccountEmailLanguages, AppEmailTemplate } from '../app-kit/index.js';

export const APP_EMAIL_TEMPLATES: AppEmailTemplate[] = [];

export const ACCOUNT_EMAIL_LANGUAGES: AccountEmailLanguages = {};
