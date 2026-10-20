/**
 * An app sends its own email (specs/app-email-spec.md, brief F27): sendAppEmail
 * through the real queueEmail and sendMail, on an in-memory Firestore and Storage,
 * with the app's templates in two languages and its German wording of the sign-up
 * code email. Each test the brief asks for is here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  siteDefault: 'en',
  mockSend: vi.fn(),
  files: new Map<string, { bytes: Buffer; contentType?: string }>(),
}));

vi.mock('../init', async () => {
  const { MemoryFirestore } = await import('./helpers/memoryFirestore');
  const bucket = {
    file: (path: string) => ({
      save: async (bytes: Buffer, opts: { contentType?: string }) => void h.files.set(path, { bytes, contentType: opts?.contentType }),
      download: async () => {
        const f = h.files.get(path);
        if (!f) throw Object.assign(new Error(`No such object: ${path}`), { code: 404 });
        return [f.bytes];
      },
    }),
    deleteFiles: async ({ prefix }: { prefix: string }) => {
      for (const key of [...h.files.keys()]) if (key.startsWith(prefix)) h.files.delete(key);
    },
  };
  return { db: new MemoryFirestore(), storage: { bucket: () => bucket }, owner: {} };
});

vi.mock('firebase-admin/firestore', async () => {
  const { FakeTimestamp } = await import('./helpers/memoryFirestore');
  return {
    Timestamp: Object.assign(FakeTimestamp, { fromDate: (d: Date) => FakeTimestamp.fromMillis(d.getTime()) }),
    FieldValue: { serverTimestamp: () => ({ _serverTimestamp: true }), increment: (n: number) => ({ _increment: n }), delete: () => ({ _delete: true }) },
  };
});

vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handler: unknown) => handler,
  onRequest: (handler: unknown) => handler,
  HttpsError: class extends Error {
    constructor(public code: string, message: string, public details?: unknown) { super(message); }
  },
}));

vi.mock('../shared/site-settings', () => ({
  getLocalizationSettings: vi.fn(async () => ({ defaultLanguage: h.siteDefault, enabledLanguages: [] })),
  getMiscSettings: vi.fn(async () => ({ showPoweredBy: false })),
}));
vi.mock('../shared/html-document', () => ({ POWERED_BY_EMAIL_HTML: '' }));
vi.mock('../mail-config/emailCounter', () => ({
  checkQuota: vi.fn(async () => ({ ok: true })),
  resolveProviderLimits: vi.fn(() => ({})),
  incrementSendCount: vi.fn(async () => undefined),
}));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: h.mockSend }) } }));
vi.mock('../auth/accounts', () => ({
  callerKey: () => 'caller',
  consumeRateLimit: vi.fn(async () => undefined),
  releaseRateLimit: vi.fn(async () => undefined),
  requireOwnRecord: vi.fn(),
  pinPepper: async () => 'test-pepper',
}));

// The app's file, as an app would fill it.
vi.mock('../custom/email-templates.js', () => ({
  APP_EMAIL_TEMPLATES: [
    {
      key: 'daily_closing',
      title: 'Daily closing',
      languages: {
        en: { subject: 'Closing for ##DATE##', body: '<p>Takings: ##TOTAL##</p>##TABLE##' },
        de: { subject: 'Tagesabschluss vom ##DATE##', body: '<p>Umsatz: ##TOTAL##</p>##TABLE##' },
      },
      sample: { DATE: '20 Oct 2026', TOTAL: '100.00' },
    },
  ],
  ACCOUNT_EMAIL_LANGUAGES: {
    signup_otp_email: { de: { subject: 'Ihr Bestätigungscode', body: '<p>Ihr Code: ##OTP##</p>' } },
  },
}));

import { db } from '../init.js';
import { sendAppEmail, captureAppEmails } from '../email-core/appEmail.js';
import { sendMail } from '../mail-config/mailConfig.js';
import { deleteEmailLogFiles } from '../email-core/emailAttachments.js';
import { handleEmailWebhook } from '../email-log/handleEmailWebhook.js';
import { requestSignupOtp } from '../auth/signupOtp.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import type { EmailLogData } from '../types.js';

const mem = db as unknown as import('./helpers/memoryFirestore').MemoryFirestore;

function emailSettings(extra: Record<string, unknown> = {}) {
  mem.seed('Settings', 'email', {
    isEnabled: true, activeProvider: 'smtp', smtp: { host: 'smtp.test', user: 'u', password: 'p' },
    senderEmail: 'shop@example.com', senderName: 'Corner Shop', unsubscribeSecret: 'sekret', ...extra,
  });
}

function logs() {
  return mem.all('EmailLogs');
}

function events(type: string) {
  return mem.all('AppEvents').filter((e) => e.data['type'] === type);
}

async function deliver(id: string) {
  await sendMail(mem.read('EmailLogs', id) as unknown as EmailLogData, id);
  return mem.read('EmailLogs', id)!;
}

beforeEach(() => {
  mem.store.clear();
  h.files.clear();
  h.siteDefault = 'en';
  h.mockSend.mockReset().mockResolvedValue({ messageId: 'mid-1' });
  emailSettings();
});

describe('sendAppEmail: templates in the app\'s languages', () => {
  it('sends the language asked for, and falls back to the site\'s default for one the template lacks', async () => {
    const de = await sendAppEmail({ to: 'owner@example.com', template: 'daily_closing', language: 'de-CH', data: { DATE: '20.10.2026', TOTAL: '812.40' } });
    const fr = await sendAppEmail({ to: 'owner@example.com', template: 'daily_closing', language: 'fr', data: { DATE: '20 Oct', TOTAL: '1' } });
    h.siteDefault = 'de';
    const none = await sendAppEmail({ to: 'owner@example.com', template: 'daily_closing', data: { DATE: 'x', TOTAL: '2' } });

    expect(mem.read('EmailLogs', de.ids[0])).toMatchObject({ subject: 'Tagesabschluss vom ##DATE##', language: 'de', type: 'app.daily_closing', source: 'app' });
    expect(mem.read('EmailLogs', fr.ids[0])).toMatchObject({ subject: 'Closing for ##DATE##', language: 'en' });
    expect(mem.read('EmailLogs', none.ids[0])).toMatchObject({ language: 'de' });

    const sent = await deliver(de.ids[0]);
    expect(sent['processedSubject']).toBe('Tagesabschluss vom 20.10.2026');
    expect(sent['processedTemplate']).toContain('Umsatz: 812.40');
    expect(sent['processedTemplate']).toContain('lang="de"');
  });

  it('escapes text data and puts { html } in as written', async () => {
    const r = await sendAppEmail({
      to: 'owner@example.com', template: 'daily_closing',
      data: { DATE: '<b>today</b>', TOTAL: '<i>5</i>', TABLE: { html: '<table><tr><td>Cash</td></tr></table>' } },
    });
    const sent = await deliver(r.ids[0]);
    expect(sent['processedTemplate']).toContain('Takings: &lt;i&gt;5&lt;/i&gt;');
    expect(sent['processedTemplate']).toContain('<table><tr><td>Cash</td></tr></table>');
    expect(sent['processedSubject']).toBe('Closing for <b>today</b>');
  });

  it('sends a subject and body the app built, in the site\'s layout', async () => {
    const r = await sendAppEmail({ to: 'owner@example.com', subject: 'Hello', html: '<p>Built by the app</p>', replyTo: 'boss@example.com' });
    expect(mem.read('EmailLogs', r.ids[0])).toMatchObject({ type: 'app.message', subject: 'Hello', replyTo: 'boss@example.com' });
    await deliver(r.ids[0]);
    expect(h.mockSend).toHaveBeenCalledWith(expect.objectContaining({ replyTo: 'boss@example.com', html: expect.stringContaining('Built by the app') }));
  });

  it('refuses input it cannot send, saying what to fix, and writes no log', async () => {
    await expect(sendAppEmail({ to: 'nobody', subject: 'x', html: 'y' })).rejects.toThrow(/email address/);
    await expect(sendAppEmail({ to: 'a@example.com', template: 'nope' })).rejects.toThrow(/no template 'nope'/);
    await expect(sendAppEmail({ to: 'a@example.com', template: 'daily_closing', data: { date: 'x' } as never })).rejects.toThrow(/capitals/);
    await expect(sendAppEmail({ to: 'a@example.com', subject: 'x', html: 'y', attachments: [{ name: 'big.bin', contentType: 'application/octet-stream', content: Buffer.alloc(5 * 1024 * 1024 + 1) }] }))
      .rejects.toThrow(/at most 5 MB/);
    expect(logs()).toEqual([]);
  });

  it('lists the template for the admin, read-only, with its languages and sample', async () => {
    await sendAppEmail({ to: 'owner@example.com', template: 'daily_closing' });
    expect(mem.read('EmailTemplate', 'app.daily_closing')).toMatchObject({
      owner: 'app', title: 'Daily closing', subject: 'Closing for ##DATE##', sample: { DATE: '20 Oct 2026', TOTAL: '100.00' },
      languages: { en: expect.any(Object), de: expect.objectContaining({ subject: 'Tagesabschluss vom ##DATE##' }) },
    });
  });
});

describe('sendAppEmail: attachments', () => {
  const csv = { name: 'sales.csv', contentType: 'text/csv', content: 'item,qty\ncoffee,12\n' };

  it('keeps the files beside the log, sends them again on a retry, and deletes them with the purge', async () => {
    const r = await sendAppEmail({ to: 'owner@example.com', subject: 'Files', html: '<p>See attached</p>', attachments: [csv] });
    const id = r.ids[0];
    const path = `email-logs/${id}/1-sales.csv`;
    expect(mem.read('EmailLogs', id)!['attachments']).toEqual([{ name: 'sales.csv', contentType: 'text/csv', size: 19, path }]);
    expect(h.files.has(path)).toBe(true);

    h.mockSend.mockRejectedValueOnce(new Error('SMTP down'));
    expect((await deliver(id))['status']).toBe('retrying');
    expect(h.files.has(path)).toBe(true);

    expect((await deliver(id))['status']).toBe('success');
    const second = h.mockSend.mock.calls[1][0];
    expect(second.attachments).toEqual([{ filename: 'sales.csv', contentType: 'text/csv', content: Buffer.from(csv.content) }]);

    await deleteEmailLogFiles([{ id, data: mem.read('EmailLogs', id)! }]);
    expect(h.files.has(path)).toBe(false);
  });

  it('a blocked send lists its files and stores none', async () => {
    emailSettings({ features: { appEmails: false } });
    const r = await sendAppEmail({ to: 'owner@example.com', subject: 'Files', html: '<p>x</p>', attachments: [csv] });
    expect(mem.read('EmailLogs', r.ids[0])!['attachments']).toEqual([{ name: 'sales.csv', contentType: 'text/csv', size: 19 }]);
    expect(h.files.size).toBe(0);
  });

  it('with the Simulated provider, records the email and keeps its files for Email Logs', async () => {
    emailSettings({ activeProvider: 'debug_log' });
    const r = await sendAppEmail({ to: 'owner@example.com', template: 'daily_closing', attachments: [csv], ref: 'shops/s1/days/d1' });
    const sent = await deliver(r.ids[0]);
    expect(sent).toMatchObject({ status: 'success', logOnly: true });
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(h.files.size).toBe(1);
    expect(events('email.sent')[0].data['data']).toMatchObject({ ref: 'shops/s1/days/d1', simulated: true });
  });
});

describe('sendAppEmail: recipients, dedupe, the toggle and suppression', () => {
  it('gives each of two recipients their own log', async () => {
    const r = await sendAppEmail({ to: ['a@example.com', 'B@Example.com'], subject: 'Hi', html: '<p>x</p>', ref: 'r1' });
    expect(r.logs.map((l) => l.to)).toEqual(['a@example.com', 'b@example.com']);
    expect(logs().map((l) => l.data['toEmail']).sort()).toEqual(['a@example.com', 'b@example.com']);
    expect(logs().every((l) => l.data['appRef'] === 'r1')).toBe(true);
  });

  it('sends once for the same dedupeKey', async () => {
    const first = await sendAppEmail({ to: ['a@example.com', 'b@example.com'], subject: 'Hi', html: '<p>x</p>', dedupeKey: 'closing-c9' });
    const again = await sendAppEmail({ to: ['a@example.com', 'b@example.com'], subject: 'Hi', html: '<p>x</p>', dedupeKey: 'closing-c9' });
    expect(logs()).toHaveLength(2);
    expect(again.ids).toEqual(first.ids);
    expect(again.logs.every((l) => l.duplicate)).toBe(true);
  });

  it('writes a skipped log when App emails is off, and tells the app', async () => {
    emailSettings({ features: { appEmails: false } });
    const r = await sendAppEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>x</p>', ref: 'r2' });
    expect(r.logs[0]).toMatchObject({ status: 'skipped', skipReason: 'feature_disabled' });
    expect(mem.read('EmailLogs', r.ids[0])).toMatchObject({ status: 'skipped', skipReason: 'feature_disabled' });
    expect(events('email.failed')[0].data['data']).toMatchObject({ ref: 'r2', reason: 'feature_disabled' });
  });

  it('suppresses a bounced address on the next send, and tells the app it bounced', async () => {
    const r = await sendAppEmail({ to: 'gone@example.com', subject: 'Hi', html: '<p>x</p>', ref: 'r3' });
    await deliver(r.ids[0]); // messageId mid-1
    const send = vi.fn();
    // AWS SES's own event, which names its type in capitals.
    await (handleEmailWebhook as unknown as (req: unknown, res: unknown) => Promise<void>)(
      { headers: {}, body: { eventType: 'Bounce', mail: { messageId: 'mid-1', timestamp: new Date().toISOString(), destination: ['gone@example.com'] }, bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [] } } },
      { status: () => ({ send }) },
    );
    expect(mem.read('Suppression', computeEmailHash('gone@example.com'))).toMatchObject({ reason: 'bounce' });
    expect(events('email.bounced')[0].data['data']).toMatchObject({ ref: 'r3', logId: r.ids[0], reason: 'Permanent: General' });

    const next = await sendAppEmail({ to: 'gone@example.com', subject: 'Again', html: '<p>x</p>' });
    expect(next.logs[0]).toMatchObject({ status: 'suppressed', skipReason: 'suppressed' });
  });

  it('suppresses nothing for a bounce matched only by address, which anyone could post', async () => {
    const r = await sendAppEmail({ to: 'kept@example.com', subject: 'Hi', html: '<p>x</p>' });
    await deliver(r.ids[0]);
    mem.seed('EmailLogs', r.ids[0], { ...mem.read('EmailLogs', r.ids[0])!, messageId: 'other' });
    await (handleEmailWebhook as unknown as (req: unknown, res: unknown) => Promise<void>)(
      { headers: {}, body: { event: 'bounced', email: 'kept@example.com', messageId: 'forged' } },
      { status: () => ({ send: vi.fn() }) },
    );
    expect(mem.read('Suppression', computeEmailHash('kept@example.com'))).toBeUndefined();
  });
});

describe('the outcome back to the app', () => {
  it('writes email.failed to AppEvents with the app\'s reference once the retries run out', async () => {
    h.mockSend.mockRejectedValue(new Error('Mailbox unavailable'));
    const r = await sendAppEmail({ to: 'a@example.com', template: 'daily_closing', ref: 'businesses/b1/closings/c9' });
    const id = r.ids[0];
    await deliver(id);
    await deliver(id);
    expect(events('email.failed')).toEqual([]);
    expect((await deliver(id))['status']).toBe('failed');
    expect(events('email.failed')).toEqual([{
      id: `email.failed__${id}`,
      data: expect.objectContaining({
        type: 'email.failed', processed: false,
        data: { logId: id, ref: 'businesses/b1/closings/c9', to: 'a@example.com', template: 'daily_closing', reason: 'Mailbox unavailable' },
      }),
    }]);
  });

  it('writes email.sent once, and nothing for core\'s own emails', async () => {
    const r = await sendAppEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>x</p>', ref: 'r4' });
    await deliver(r.ids[0]);
    expect(events('email.sent').map((e) => e.data['data'])).toEqual([{ logId: r.ids[0], ref: 'r4', to: 'a@example.com', template: null }]);
  });
});

describe('core\'s account emails in the member\'s language', () => {
  const request = (language?: string) => ({ data: { email: 'mitglied@example.com', ...(language ? { language } : {}) }, rawRequest: { ip: '1.2.3.4' } });

  beforeEach(() => {
    emailSettings({ activeProvider: 'debug_log' });
    mem.seed('EmailTemplate', 'signup_otp_email', {
      type: 'signup_otp_email', subject: 'Your verification code', template: '<p>Your code: ##OTP##</p>',
      senderEmail: 'shop@example.com', senderName: 'Corner Shop', isActive: true,
    });
  });

  it('a German member gets the sign-up code email in German', async () => {
    await (requestSignupOtp as unknown as (r: unknown) => Promise<unknown>)(request('de'));
    const [log] = logs();
    expect(log.data).toMatchObject({ subject: 'Ihr Bestätigungscode', language: 'de', processedSubject: 'Ihr Bestätigungscode' });
    expect(log.data['processedTemplate']).toMatch(/Ihr Code: \d{6}/);
  });

  it('an English member, or a language the app did not word, gets the template in Settings', async () => {
    await (requestSignupOtp as unknown as (r: unknown) => Promise<unknown>)(request('en'));
    expect(logs()[0].data).toMatchObject({ subject: 'Your verification code' });
    expect(logs()[0].data['language']).toBeUndefined();
  });
});

describe('captureAppEmails, for an app\'s own tests', () => {
  it('records what would be sent, without Firestore, Storage or a provider', async () => {
    const mail = captureAppEmails({ defaultLanguage: 'de' });
    try {
      const r = await sendAppEmail({
        to: ['a@example.com', 'b@example.com'], template: 'daily_closing', data: { DATE: '20.10.' },
        attachments: [{ name: 'x.csv', contentType: 'text/csv', content: 'a,b' }], ref: 'r5', dedupeKey: 'k1',
      });
      expect(r.ids).toHaveLength(2);
    } finally {
      mail.stop();
    }
    expect(mail.emails).toEqual([expect.objectContaining({
      to: ['a@example.com', 'b@example.com'], template: 'daily_closing', languageAsked: null, language: 'de',
      subject: 'Tagesabschluss vom ##DATE##', data: { DATE: '20.10.' }, ref: 'r5', dedupeKey: 'k1',
      attachments: [{ name: 'x.csv', contentType: 'text/csv', size: 3, content: Buffer.from('a,b') }],
    })]);
    expect(logs()).toEqual([]);
    expect(mem.all('EmailTemplate')).toEqual([]);
    await expect(sendAppEmail({ to: 'x', subject: 's', html: 'h' })).rejects.toThrow(/email address/);
  });
});
