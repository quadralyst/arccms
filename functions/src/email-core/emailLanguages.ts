/**
 * Email in the site's languages (specs/app-email-spec.md, AE-D2, AE-D4).
 *
 * An app ships its own templates, one subject and body per language, and its
 * wording of core's account emails in the languages it adds, in
 * functions/src/custom/email-templates.ts (docs/app/app-email.html). A send asks
 * for a language and gets the closest version this file and the site have.
 */

/** One language's version of an email. `body` is the inside of the email, wrapped in the site's layout. */
export interface EmailLanguageVersion {
  subject: string;
  body: string;
  /** The line a mail app shows after the subject. */
  previewText?: string;
}

/** A template an app ships (APP_EMAIL_TEMPLATES). */
export interface AppEmailTemplate {
  /** Its name in code: a-z, 0-9 and _, such as `daily_closing`. */
  key: string;
  /** Its name in the admin's template list. */
  title: string;
  /** Each language's version, by code (`en`, `de`). */
  languages: Record<string, EmailLanguageVersion>;
  /** Tag data for the admin's preview, such as `{ DATE: '20 October 2026' }`. */
  sample?: Record<string, string>;
}

/** Core's account emails an app may word in its languages (ACCOUNT_EMAIL_LANGUAGES). */
export const ACCOUNT_EMAIL_TYPES = ['signup_otp_email', 'password_reset_otp_email', 'pin_reset_otp_email'] as const;
export type AccountEmailType = (typeof ACCOUNT_EMAIL_TYPES)[number];

/** The app's wording of core's account emails, by template and language. English is the template in Settings. */
export type AccountEmailLanguages = Partial<Record<AccountEmailType, Record<string, EmailLanguageVersion>>>;

/** The language core's own templates are written in. */
export const BASE_LANGUAGE = 'en';

/** The type, and EmailTemplate document id, of an app template. */
export function appTemplateType(key: string): string {
  return `app.${key}`;
}

const KEY_PATTERN = /^[a-z0-9_]{1,60}$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

/** A language code as compared here: trimmed and lower-case (`de-CH` is `de-ch`). */
export function normalizeLanguage(code: unknown): string {
  return typeof code === 'string' ? code.trim().toLowerCase().replace(/_/g, '-') : '';
}

/** The codes to try for a language, most exact first: `de-ch`, then `de`. */
export function languageCandidates(code: unknown): string[] {
  const lang = normalizeLanguage(code);
  if (!lang) return [];
  const primary = lang.split('-')[0];
  return primary === lang ? [lang] : [lang, primary];
}

function versionProblems(where: string, lang: string, version: unknown): string[] {
  const problems: string[] = [];
  if (!LANGUAGE_PATTERN.test(lang)) problems.push(`${where}: '${lang}' is not a language code such as 'de' or 'pt-br'.`);
  const v = version as Partial<EmailLanguageVersion> | undefined;
  if (!v || typeof v.subject !== 'string' || !v.subject.trim()) problems.push(`${where}, ${lang}: give it a subject.`);
  if (!v || typeof v.body !== 'string' || !v.body.trim()) problems.push(`${where}, ${lang}: give it a body.`);
  if (v?.previewText !== undefined && typeof v.previewText !== 'string') problems.push(`${where}, ${lang}: previewText is text.`);
  return problems;
}

/** What is wrong in functions/src/custom/email-templates.ts, one line each. Empty when all is well. */
export function emailTemplateProblems(templates: unknown, accountLanguages: unknown): string[] {
  const problems: string[] = [];
  if (!Array.isArray(templates)) {
    problems.push('APP_EMAIL_TEMPLATES must be a list.');
  } else {
    const seen = new Set<string>();
    templates.forEach((t: Partial<AppEmailTemplate> | undefined, i) => {
      const key = typeof t?.key === 'string' ? t.key : '';
      const where = `APP_EMAIL_TEMPLATES '${key || `#${i + 1}`}'`;
      if (!KEY_PATTERN.test(key)) problems.push(`${where}: key must be a-z, 0-9 and _ only, such as 'daily_closing'.`);
      else if (seen.has(key)) problems.push(`${where}: the key is used twice.`);
      seen.add(key);
      if (typeof t?.title !== 'string' || !t.title.trim()) problems.push(`${where}: give it a title, its name in the admin.`);
      const langs = t?.languages && typeof t.languages === 'object' ? Object.entries(t.languages) : [];
      if (!langs.length) problems.push(`${where}: give it at least one language, such as languages: { en: { subject, body } }.`);
      for (const [lang, version] of langs) problems.push(...versionProblems(where, lang, version));
      if (t?.sample !== undefined && (typeof t.sample !== 'object' || t.sample === null)) problems.push(`${where}: sample is tag data, such as { DATE: '20 October 2026' }.`);
    });
  }
  if (accountLanguages === null || typeof accountLanguages !== 'object' || Array.isArray(accountLanguages)) {
    problems.push('ACCOUNT_EMAIL_LANGUAGES must be an object, such as { signup_otp_email: { de: { subject, body } } }.');
  } else {
    for (const [type, langs] of Object.entries(accountLanguages)) {
      const where = `ACCOUNT_EMAIL_LANGUAGES '${type}'`;
      if (!(ACCOUNT_EMAIL_TYPES as readonly string[]).includes(type)) {
        problems.push(`${where}: only ${ACCOUNT_EMAIL_TYPES.slice(0, -1).join(', ')} and ${ACCOUNT_EMAIL_TYPES.at(-1)} take languages.`);
        continue;
      }
      for (const [lang, version] of Object.entries((langs as Record<string, unknown>) ?? {})) {
        if (normalizeLanguage(lang) === BASE_LANGUAGE) {
          problems.push(`${where}, en: English is the template in Settings; an admin edits it in Email, Composer.`);
          continue;
        }
        problems.push(...versionProblems(where, lang, version));
      }
    }
  }
  return problems;
}

/** Throws with every problem, naming the file, so the functions stop loading (and the deploy fails) on a mistake. */
export function assertEmailTemplates(templates: unknown, accountLanguages: unknown): void {
  const problems = emailTemplateProblems(templates, accountLanguages);
  if (problems.length) throw new Error(`functions/src/custom/email-templates.ts:\n  - ${problems.join('\n  - ')}`);
}

/** A version map with its codes compared as normalizeLanguage does. */
function byLanguage<V>(languages: Record<string, V>): Map<string, V> {
  return new Map(Object.entries(languages).map(([code, v]) => [normalizeLanguage(code), v]));
}

/**
 * An app template's version for a send (AE-D4): the language asked for, else the
 * site's default language, else English, else the first one the template has.
 */
export function pickAppTemplateVersion(
  template: AppEmailTemplate,
  asked: unknown,
  siteDefault: string,
): { language: string; version: EmailLanguageVersion } {
  const versions = byLanguage(template.languages);
  for (const code of [...languageCandidates(asked), ...languageCandidates(siteDefault), BASE_LANGUAGE]) {
    const version = versions.get(code);
    if (version) return { language: code, version };
  }
  const [language, version] = [...versions.entries()][0];
  return { language, version };
}

/**
 * The app's version of an account email for a send, or null for the template in
 * Settings (AE-D4): the language asked for, else the site's default. English, or a
 * language the app gave no wording for, is the template in Settings.
 */
export function pickAccountEmailVersion(
  type: string,
  accountLanguages: AccountEmailLanguages,
  asked: unknown,
  siteDefault: string,
): { language: string; version: EmailLanguageVersion } | null {
  const versions = byLanguage(accountLanguages[type as AccountEmailType] ?? {});
  for (const code of [...languageCandidates(asked), ...languageCandidates(siteDefault)]) {
    if (code === BASE_LANGUAGE) return null;
    const version = versions.get(code);
    if (version) return { language: code, version };
  }
  return null;
}
