/**
 * Email in the app's languages (specs/app-email-spec.md, AE-D2, AE-D4, AE-D7): the
 * checks on functions/src/custom/email-templates.ts, which language a send gets,
 * and the layout's brand defaults.
 */
import { describe, expect, it } from 'vitest';
import {
  assertEmailTemplates,
  emailTemplateProblems,
  languageCandidates,
  pickAccountEmailVersion,
  pickAppTemplateVersion,
  type AppEmailTemplate,
} from '../email-core/emailLanguages.js';
import { DEFAULT_EMAIL_BRAND, wrapInEmailLayout } from '../email-core/emailLayout.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { starterExports } from '../../../scripts/custom-starters.mjs';

const closing: AppEmailTemplate = {
  key: 'daily_closing',
  title: 'Daily closing',
  languages: { en: { subject: 'Closing', body: '<p>en</p>' }, de: { subject: 'Abschluss', body: '<p>de</p>' } },
};

describe('the checks on functions/src/custom/email-templates.ts', () => {
  it('accept the file as Arc CMS ships it, and a good template', () => {
    const shipped = starterExports('functions/src/custom/email-templates.ts');
    expect(emailTemplateProblems(shipped['APP_EMAIL_TEMPLATES'], shipped['ACCOUNT_EMAIL_LANGUAGES'])).toEqual([]);
    expect(emailTemplateProblems([closing], { signup_otp_email: { de: { subject: 'Code', body: '##OTP##' } } })).toEqual([]);
  });

  it('name each mistake, so the deploy fails saying what to fix', () => {
    const problems = emailTemplateProblems(
      [closing, { ...closing }, { key: 'Bad-Key', title: '', languages: { english: { subject: '', body: 'x' } } }],
      { welcome_email: {}, signup_otp_email: { en: { subject: 'x', body: 'y' } } },
    );
    expect(problems).toEqual([
      "APP_EMAIL_TEMPLATES 'daily_closing': the key is used twice.",
      "APP_EMAIL_TEMPLATES 'Bad-Key': key must be a-z, 0-9 and _ only, such as 'daily_closing'.",
      "APP_EMAIL_TEMPLATES 'Bad-Key': give it a title, its name in the admin.",
      "APP_EMAIL_TEMPLATES 'Bad-Key': 'english' is not a language code such as 'de' or 'pt-br'.",
      "APP_EMAIL_TEMPLATES 'Bad-Key', english: give it a subject.",
      "ACCOUNT_EMAIL_LANGUAGES 'welcome_email': only signup_otp_email, password_reset_otp_email and pin_reset_otp_email take languages.",
      "ACCOUNT_EMAIL_LANGUAGES 'signup_otp_email', en: English is the template in Settings; an admin edits it in Email, Composer.",
    ]);
    expect(() => assertEmailTemplates([{ key: 'x', title: 'X', languages: {} }], {})).toThrow(/functions\/src\/custom\/email-templates\.ts:\n {2}- /);
  });
});

describe('which language a send gets (AE-D4)', () => {
  it('tries the exact code, then its language', () => {
    expect(languageCandidates('de-CH')).toEqual(['de-ch', 'de']);
    expect(languageCandidates('  ')).toEqual([]);
  });

  it('an app template: asked, else the site default, else English, else its first language', () => {
    expect(pickAppTemplateVersion(closing, 'de-AT', 'en').language).toBe('de');
    expect(pickAppTemplateVersion(closing, 'fr', 'de').language).toBe('de');
    expect(pickAppTemplateVersion(closing, 'fr', 'it').language).toBe('en');
    const germanOnly = { ...closing, languages: { de: closing.languages['de'] } };
    expect(pickAppTemplateVersion(germanOnly, 'fr', 'it').language).toBe('de');
  });

  it('an account email: asked, else the site default, else the template in Settings; English is always Settings', () => {
    const langs = { signup_otp_email: { de: { subject: 'Code', body: 'x' } } };
    expect(pickAccountEmailVersion('signup_otp_email', langs, 'de', 'en')?.language).toBe('de');
    expect(pickAccountEmailVersion('signup_otp_email', langs, 'fr', 'de')?.language).toBe('de');
    expect(pickAccountEmailVersion('signup_otp_email', langs, 'en', 'de')).toBeNull();
    expect(pickAccountEmailVersion('signup_otp_email', langs, 'fr', 'en')).toBeNull();
    expect(pickAccountEmailVersion('password_reset_otp_email', langs, 'de', 'de')).toBeNull();
  });
});

describe('the site\'s email layout (AE-D7)', () => {
  it('starts from the Brand Kit\'s own defaults (DEFAULT_BRAND_KIT in the browser)', () => {
    // Read as text: the functions cannot import the browser's files.
    const model = readFileSync(resolve(__dirname, '../../../src/shared/email-compiler/email-design.model.ts'), 'utf8');
    const block = model.slice(model.indexOf('export const DEFAULT_BRAND_KIT'), model.indexOf('};', model.indexOf('export const DEFAULT_BRAND_KIT')));
    const firstFont = /SAFE_FONTS: string\[\] = \[\s*"([^"]+)"/.exec(model)?.[1];
    for (const [key, value] of Object.entries(DEFAULT_EMAIL_BRAND)) {
      const line = new RegExp(`\\b${key}: ([^,\\n]+),`).exec(block)?.[1]?.trim();
      const browser = line === 'SAFE_FONTS[0]' ? firstFont : line?.replace(/^'|'$/g, '');
      expect(String(value), key).toBe(browser);
    }
  });

  it('wraps the body with the brand, and drops values that could break out of the markup', () => {
    const html = wrapInEmailLayout('<p>Hi</p>', { ...DEFAULT_EMAIL_BRAND, primaryColor: '#000', backgroundColor: 'red;}<script>', logoUrl: 'javascript:x' }, 'de');
    expect(html).toContain('<p>Hi</p>');
    expect(html).toContain('lang="de"');
    expect(html).toContain('##COMPANY_NAME##');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });
});
