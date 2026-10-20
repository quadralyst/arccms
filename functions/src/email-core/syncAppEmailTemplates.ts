import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { isArcAdmin } from '../users/claims.js';
import type { EmailSettings } from '../types.js';
import { ACCOUNT_EMAIL_TYPES, appTemplateType, pickAppTemplateVersion, type AppEmailTemplate } from './emailLanguages.js';
import { accountEmailLanguages, appEmailTemplates, siteDefaultLanguage } from './appEmailTemplates.js';
import { DEFAULT_EMAIL_BRAND, readEmailBrand, wrapInEmailLayout, type EmailBrand } from './emailLayout.js';

/**
 * The app's templates in the admin's template list (specs/app-email-spec.md, AE-D13).
 *
 * Each app template is an `EmailTemplate` document `app.{key}` with `owner: 'app'`:
 * read-only in Email, Composer, with every language (`languages`) and the sample data
 * (`sample`) for its preview. Sends read the template from the code, never from here,
 * so this list only has to catch up: it is written when missing or changed, removed
 * when the template is gone from the file, by syncAppEmailTemplates (the composer
 * calls it when it opens), by seedEmailTemplates, and by each send for its template.
 */

/** Who owns a template document the app shipped. */
export const APP_TEMPLATE_OWNER = 'app';

/** A short hash of what the app shipped, so an unchanged template is not written again. */
export function appTemplateHash(template: AppEmailTemplate, defaultLanguage: string): string {
  return createHash('sha256').update(JSON.stringify([template, defaultLanguage])).digest('hex').slice(0, 16);
}

/** The template document for an app template, its own subject and body in the site's default language. */
export function appTemplateDoc(
  template: AppEmailTemplate,
  options: { defaultLanguage: string; brand?: EmailBrand; senderName?: string; senderEmail?: string },
): Record<string, unknown> {
  const brand = options.brand ?? DEFAULT_EMAIL_BRAND;
  const main = pickAppTemplateVersion(template, '', options.defaultLanguage);
  const languages: Record<string, { subject: string; template: string; previewText: string }> = {};
  for (const [code, version] of Object.entries(template.languages)) {
    languages[code.toLowerCase()] = {
      subject: version.subject,
      template: wrapInEmailLayout(version.body, brand, code),
      previewText: version.previewText ?? '',
    };
  }
  const type = appTemplateType(template.key);
  return {
    id: type,
    type,
    owner: APP_TEMPLATE_OWNER,
    appKey: template.key,
    category: 'transactional',
    title: template.title,
    subject: main.version.subject,
    template: wrapInEmailLayout(main.version.body, brand, main.language),
    previewText: main.version.previewText ?? '',
    language: main.language,
    languages,
    sample: template.sample ?? {},
    senderName: options.senderName ?? '',
    senderEmail: options.senderEmail ?? '',
    isActive: true,
    editorVersion: 'html',
    scope: 'global',
    createdBy: APP_TEMPLATE_OWNER,
    modifiedBy: APP_TEMPLATE_OWNER,
    appHash: appTemplateHash(template, options.defaultLanguage),
  };
}

async function sender(): Promise<{ senderName: string; senderEmail: string }> {
  const settings = (await db.collection('Settings').doc('email').get()).data() as EmailSettings | undefined;
  return { senderName: settings?.senderName || '', senderEmail: settings?.senderEmail || '' };
}

/** Write one app template's document when it is missing or the app changed it. True when written. */
export async function ensureAppTemplateDoc(template: AppEmailTemplate): Promise<boolean> {
  const defaultLanguage = await siteDefaultLanguage();
  const ref = db.collection('EmailTemplate').doc(appTemplateType(template.key));
  const snap = await ref.get();
  if (snap.exists && snap.data()?.['appHash'] === appTemplateHash(template, defaultLanguage)) return false;
  const now = Timestamp.now();
  await ref.set({
    ...appTemplateDoc(template, { defaultLanguage, brand: await readEmailBrand(), ...(await sender()) }),
    createdAt: snap.exists ? snap.data()?.['createdAt'] ?? now : now,
    modifiedAt: now,
  });
  return true;
}

/**
 * Bring the template list in line with the app's file: every app template written
 * when missing or changed, the ones gone from the file removed, and the app's
 * languages of the account emails shown on their templates (for the preview).
 */
export async function syncAllAppEmailTemplates(): Promise<{ written: string[]; removed: string[] }> {
  const written: string[] = [];
  const removed: string[] = [];
  const templates = appEmailTemplates();
  for (const template of templates) {
    if (await ensureAppTemplateDoc(template)) written.push(template.key);
  }
  const keep = new Set(templates.map((t) => appTemplateType(t.key)));
  const shipped = await db.collection('EmailTemplate').where('owner', '==', APP_TEMPLATE_OWNER).get();
  for (const doc of shipped.docs) {
    if (!keep.has(doc.id)) {
      await doc.ref.delete();
      removed.push(String(doc.data()?.['appKey'] ?? doc.id));
    }
  }

  const brand = await readEmailBrand();
  for (const type of ACCOUNT_EMAIL_TYPES) {
    const ref = db.collection('EmailTemplate').doc(type);
    const snap = await ref.get();
    const languages: Record<string, unknown> = {};
    for (const [code, version] of Object.entries(accountEmailLanguages()[type] ?? {})) {
      languages[code.toLowerCase()] = { subject: version.subject, template: wrapInEmailLayout(version.body, brand, code), previewText: version.previewText ?? '' };
    }
    if (!snap.exists || JSON.stringify(snap.data()?.['languages'] ?? {}) === JSON.stringify(languages)) continue;
    await ref.update({ languages });
  }
  return { written, removed };
}

/** Admin callable: bring the template list in line with the app's file (Email, Composer calls it when it opens). */
export const syncAppEmailTemplates = onCall(async (request) => {
  if (!isArcAdmin(request.auth?.token)) throw new HttpsError('permission-denied', 'Admin role required.');
  return syncAllAppEmailTemplates();
});
