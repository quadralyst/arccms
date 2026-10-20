import { db } from '../init.js';
import type { EmailSettings } from '../types.js';
import { queueEmail, type AppTagValue, type QueueEmailResult } from './queueEmail.js';
import { computeEmailHash } from './unsubscribeToken.js';
import { prepareAttachments, type EmailAttachmentInput, type PreparedAttachment } from './emailAttachments.js';
import { appTemplateType, normalizeLanguage, pickAppTemplateVersion } from './emailLanguages.js';
import { findAppEmailTemplate, rendered, siteDefaultLanguage } from './appEmailTemplates.js';
import { ensureAppTemplateDoc } from './syncAppEmailTemplates.js';
import { DEFAULT_EMAIL_BRAND, type EmailBrand } from './emailLayout.js';

/**
 * An app sends its own email (specs/app-email-spec.md, docs/app/app-email.html).
 *
 * `sendAppEmail` is the app kit's way for an app's Cloud Functions to send
 * transactional email: one of its templates (APP_EMAIL_TEMPLATES in
 * functions/src/custom/email-templates.ts) in a language, or a subject and body it
 * built, inside the site's email layout, to one or more addresses, with files. Each
 * address gets its own log through queueEmail, so the kill switch, the App emails
 * toggle, suppression, retries and dedupe all apply; the outcome comes back to the
 * app as AppEvents (appEmailOutcome.ts).
 */

/** At most this many addresses in one call. */
export const MAX_APP_EMAIL_RECIPIENTS = 50;
/** The log type of an email whose subject and body the app built. */
export const APP_MESSAGE_TYPE = 'app.message';

export interface SendAppEmailInput {
  /** One address or a list (1 to 50). Each gets its own log. */
  to: string | string[];
  /** The key of one of the app's templates. Give this, or `subject` and `html`. */
  template?: string;
  /** Data for the template's ##TAG## tokens, by tag (`DATE` fills ##DATE##). Text is escaped; `{ html }` goes in as written. */
  data?: Record<string, AppTagValue>;
  /** A subject the app wrote, with `html`, instead of a template. */
  subject?: string;
  /** The inside of the email the app built, wrapped in the site's email layout. */
  html?: string;
  /** A plain-text version, for mail apps that show no HTML. */
  text?: string;
  /** The language to send in, such as `de`. Default: the site's default language. */
  language?: string;
  /** Files, up to 10 and 5 MB in all. */
  attachments?: EmailAttachmentInput[];
  /** Where replies go. Default: Settings, Email's reply-to address. */
  replyTo?: string;
  /** A stable key for this email, such as `closing-c9`: calling again with it sends nothing new. */
  dedupeKey?: string;
  /** The app's own reference, such as `businesses/b1/closings/c9`, kept on the log and in the outcome events. */
  ref?: string;
}

export interface SendAppEmailLog {
  to: string;
  id: string;
  status: QueueEmailResult['status'];
  skipReason?: QueueEmailResult['skipReason'];
  duplicate?: boolean;
}

export interface SendAppEmailResult {
  /** One per address, in the order given. */
  logs: SendAppEmailLog[];
  /** The log ids, the same order. */
  ids: string[];
}

/** An email as captureAppEmails records it. */
export interface CapturedAppEmail {
  to: string[];
  template: string | null;
  /** The language asked for, and the one sent (after falling back). */
  languageAsked: string | null;
  language: string;
  subject: string;
  /** The body as queued, inside the site's layout, ##TAG## tokens not yet filled. */
  html: string;
  text: string;
  data: Record<string, AppTagValue>;
  attachments: Array<{ name: string; contentType: string; size: number; content: Buffer }>;
  replyTo: string | null;
  dedupeKey: string | null;
  ref: string | null;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const TAG_KEY = /^[A-Z_]+$/;

function fail(message: string): never {
  throw new Error(`sendAppEmail: ${message}`);
}

function checkedRecipients(to: unknown): string[] {
  const list = (Array.isArray(to) ? to : [to]).map((a) => (typeof a === 'string' ? a.trim().toLowerCase() : ''));
  if (!list.length || list.some((a) => !EMAIL.test(a))) fail('to must be one email address or a list of them.');
  const unique = [...new Set(list)];
  if (unique.length > MAX_APP_EMAIL_RECIPIENTS) fail(`at most ${MAX_APP_EMAIL_RECIPIENTS} addresses in one call.`);
  return unique;
}

function checkedData(data: unknown): Record<string, AppTagValue> {
  if (data === undefined) return {};
  if (typeof data !== 'object' || data === null || Array.isArray(data)) fail('data is tag data, such as { DATE: \'20 October 2026\' }.');
  for (const [key, value] of Object.entries(data)) {
    if (!TAG_KEY.test(key)) fail(`data key '${key}' must be capitals and _ only, as in its tag ##${key.toUpperCase().replace(/[^A-Z_]/g, '_')}##.`);
    const ok = ['string', 'number', 'boolean'].includes(typeof value)
      || (typeof value === 'object' && value !== null && typeof (value as { html?: unknown }).html === 'string');
    if (!ok) fail(`data '${key}' must be text, a number, true or false, or { html }.`);
  }
  return data as Record<string, AppTagValue>;
}

function optionalText(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) fail(`${name} must be text of at most ${max} characters.`);
  return value;
}

interface Composed {
  recipients: string[];
  templateKey: string | null;
  type: string;
  languageAsked: string | null;
  language: string;
  subject: string;
  html: string;
  text: string;
  data: Record<string, AppTagValue>;
  files: PreparedAttachment[];
  replyTo?: string;
  dedupeKey?: string;
  ref?: string;
}

/** Check the input and build the email, as a real send and a capture both do. */
async function compose(input: SendAppEmailInput, defaultLanguage: () => Promise<string>, brand?: EmailBrand): Promise<Composed> {
  if (!input || typeof input !== 'object') fail('give it { to, template, data } or { to, subject, html }.');
  const recipients = checkedRecipients(input.to);
  const data = checkedData(input.data);
  const files = prepareAttachments(input.attachments);
  const replyTo = optionalText(input.replyTo, 'replyTo', 320)?.trim();
  if (replyTo && !EMAIL.test(replyTo)) fail('replyTo must be an email address.');
  const dedupeKey = optionalText(input.dedupeKey, 'dedupeKey', 300);
  const ref = optionalText(input.ref, 'ref', 500);
  const languageAsked = normalizeLanguage(input.language) || null;
  const text = optionalText(input.text, 'text', 100_000) ?? '';

  if (input.template !== undefined) {
    if (input.subject !== undefined || input.html !== undefined) fail('give a template, or a subject and html, not both.');
    const template = typeof input.template === 'string' ? findAppEmailTemplate(input.template) : undefined;
    if (!template) fail(`there is no template '${String(input.template)}' in APP_EMAIL_TEMPLATES (functions/src/custom/email-templates.ts).`);
    const picked = pickAppTemplateVersion(template, languageAsked, await defaultLanguage());
    const email = await rendered(picked.language, picked.version, brand);
    return {
      recipients, templateKey: template.key, type: appTemplateType(template.key), languageAsked,
      language: email.language, subject: email.subject, html: email.template, text: text || email.previewText,
      data, files, replyTo, dedupeKey, ref,
    };
  }
  const subject = optionalText(input.subject, 'subject', 1000);
  const html = optionalText(input.html, 'html', 500_000);
  if (!subject || !html) fail('give a template, or a subject and html.');
  const language = languageAsked || normalizeLanguage(await defaultLanguage()) || 'en';
  const email = await rendered(language, { subject, body: html }, brand);
  return {
    recipients, templateKey: null, type: APP_MESSAGE_TYPE, languageAsked,
    language, subject: email.subject, html: email.template, text, data, files, replyTo, dedupeKey, ref,
  };
}

let captured: CapturedAppEmail[] | null = null;
let capturedDefaultLanguage = 'en';

/**
 * For an app's unit tests (AE-D14): while it runs, sendAppEmail checks its input
 * exactly as for real, then records the email here instead of touching Firestore,
 * Storage or a mail provider. `emails` fills as the code under test sends; `stop()`
 * ends it. `defaultLanguage` stands in for the site's default language (Settings,
 * Languages), English unless given.
 *
 *   const mail = captureAppEmails({ defaultLanguage: 'de' });
 *   await closeDay('b1');
 *   expect(mail.emails[0].language).toBe('de');
 *   mail.stop();
 */
export function captureAppEmails(options: { defaultLanguage?: string } = {}): { emails: CapturedAppEmail[]; stop: () => void } {
  const emails: CapturedAppEmail[] = [];
  captured = emails;
  capturedDefaultLanguage = options.defaultLanguage || 'en';
  return {
    emails,
    stop: () => {
      if (captured === emails) captured = null;
    },
  };
}

/**
 * Send a transactional email from the app's own Cloud Functions. Throws, saying what
 * to fix, when the input is wrong (no log is written then). Otherwise returns one
 * log per address: `pending` (on its way), or `skipped` / `suppressed` with the
 * reason (email off, App emails off, the address bounced). The outcome of each
 * arrives later in AppEvents as email.sent, email.failed or email.bounced.
 */
export async function sendAppEmail(input: SendAppEmailInput): Promise<SendAppEmailResult> {
  if (captured) {
    const sink = captured;
    const email = await compose(input, async () => capturedDefaultLanguage, DEFAULT_EMAIL_BRAND);
    sink.push({
      to: email.recipients, template: email.templateKey, languageAsked: email.languageAsked, language: email.language,
      subject: email.subject, html: email.html, text: email.text, data: email.data,
      attachments: email.files.map(({ name, contentType, size, bytes }) => ({ name, contentType, size, content: bytes })),
      replyTo: email.replyTo ?? null, dedupeKey: email.dedupeKey ?? null, ref: email.ref ?? null,
    });
    const logs = email.recipients.map((to, i) => ({ to, id: `captured-${sink.length}-${i + 1}`, status: 'pending' as const }));
    return { logs, ids: logs.map((l) => l.id) };
  }

  const email = await compose(input, siteDefaultLanguage);
  const settings = (await db.collection('Settings').doc('email').get()).data() as EmailSettings | undefined;
  if (email.templateKey) {
    // Keeps the admin's template list up to date; never stops the send.
    const template = findAppEmailTemplate(email.templateKey);
    if (template) await ensureAppTemplateDoc(template).catch((err) => console.warn('sendAppEmail: template list not updated', err));
  }

  const logs: SendAppEmailLog[] = [];
  for (const to of email.recipients) {
    const result = await queueEmail({
      source: 'app',
      category: 'transactional',
      toEmail: to,
      senderEmail: settings?.senderEmail || '',
      senderName: settings?.senderName || settings?.companyName || '',
      subject: email.subject,
      template: email.html,
      text: email.text,
      type: email.type,
      language: email.language,
      replyTo: email.replyTo,
      app: { ref: email.ref, template: email.templateKey ?? undefined, data: email.data },
      attachments: email.files,
      // Each address has its own log, so each has its own key.
      dedupeKey: email.dedupeKey ? `${email.dedupeKey}__${computeEmailHash(to).slice(0, 16)}` : undefined,
      emailSettings: settings,
    });
    logs.push({
      to, id: result.id, status: result.status,
      ...(result.skipReason ? { skipReason: result.skipReason } : {}),
      ...(result.duplicate ? { duplicate: true } : {}),
    });
  }
  return { logs, ids: logs.map((l) => l.id) };
}
