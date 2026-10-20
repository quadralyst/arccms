import { ACCOUNT_EMAIL_LANGUAGES, APP_EMAIL_TEMPLATES } from '../custom/email-templates.js';
import { getLocalizationSettings } from '../shared/site-settings.js';
import {
  assertEmailTemplates,
  pickAccountEmailVersion,
  type AccountEmailLanguages,
  type AppEmailTemplate,
  type EmailLanguageVersion,
} from './emailLanguages.js';
import { readEmailBrand, wrapInEmailLayout, type EmailBrand } from './emailLayout.js';

/**
 * The app's email templates and account email wording, from
 * functions/src/custom/email-templates.ts, checked once when the functions load
 * (specs/app-email-spec.md, AE-D2): a mistake stops them loading, so the deploy
 * fails with the reason rather than an email failing later.
 */
assertEmailTemplates(APP_EMAIL_TEMPLATES, ACCOUNT_EMAIL_LANGUAGES);

/** The app's templates. */
export function appEmailTemplates(): readonly AppEmailTemplate[] {
  return APP_EMAIL_TEMPLATES;
}

/** The app's template with this key, or undefined. */
export function findAppEmailTemplate(key: string): AppEmailTemplate | undefined {
  return APP_EMAIL_TEMPLATES.find((t) => t.key === key);
}

/** The app's wording of core's account emails. */
export function accountEmailLanguages(): AccountEmailLanguages {
  return ACCOUNT_EMAIL_LANGUAGES;
}

/** The site's default language, '' when it cannot be read. */
export async function siteDefaultLanguage(): Promise<string> {
  try {
    return (await getLocalizationSettings()).defaultLanguage;
  } catch {
    return '';
  }
}

/**
 * An account email (`signup_otp_email`, `password_reset_otp_email`) in the member's
 * language (AE-D4, AE-D5): the app's version for that language, else the site's
 * default, inside the site's layout; null for the template in Settings. Nothing is
 * read when the app words this email in no language.
 */
export async function accountEmailInLanguage(
  type: string,
  language: unknown,
): Promise<{ language: string; subject: string; template: string; previewText: string } | null> {
  const worded = ACCOUNT_EMAIL_LANGUAGES[type as keyof AccountEmailLanguages];
  if (!worded || !Object.keys(worded).length) return null;
  const picked = pickAccountEmailVersion(type, ACCOUNT_EMAIL_LANGUAGES, language, await siteDefaultLanguage());
  return picked ? await rendered(picked.language, picked.version) : null;
}

/** A language version as a log takes it: the subject, and the body inside the site's layout (the Brand Kit unless `brand` is given). */
export async function rendered(
  language: string,
  version: EmailLanguageVersion,
  brand?: EmailBrand,
): Promise<{ language: string; subject: string; template: string; previewText: string }> {
  return {
    language,
    subject: version.subject,
    template: wrapInEmailLayout(version.body, brand ?? (await readEmailBrand()), language),
    previewText: version.previewText ?? '',
  };
}
