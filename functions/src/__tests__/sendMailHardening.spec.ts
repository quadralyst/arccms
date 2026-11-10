/**
 * Behavioural tests for the Phase 1 sendMail() hardening
 * (functions/src/mail-config/mailConfig.ts):
 *   - belt-and-braces kill-switch (skipped/email_disabled)
 *   - universal quota enforcement (deferred/quota)
 *   - retry with backoff (retrying → failed at maxAttempts), attempts counter
 *   - List-Unsubscribe headers on marketing sends only
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettingsGet,
  mockLogUpdate,
  mockCheckQuota,
  mockResolveLimits,
  mockIncrement,
  mockTransportSend,
  mockGetSiteConfig,
} = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockLogUpdate: vi.fn().mockResolvedValue(undefined),
  mockCheckQuota: vi.fn().mockResolvedValue({ ok: true, dailyCount: 0, hourlyCount: 0 }),
  mockResolveLimits: vi.fn().mockReturnValue({ perSecond: 1 }),
  mockIncrement: vi.fn().mockResolvedValue(undefined),
  mockTransportSend: vi.fn().mockResolvedValue({ messageId: 'mid-1' }),
  mockGetSiteConfig: vi.fn().mockResolvedValue({ siteName: '' }),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'Settings') return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
      if (name === 'EmailLogs') return { doc: vi.fn().mockReturnValue({ update: mockLogUpdate }) };
      return {};
    }),
  },
}));

vi.mock('../constant', () => ({
  constant: { isProduction: false, live_url: 'https://app.example.com/', local_url: 'http://localhost:5173/', TRACKING_PIXEL_URL: '' },
}));

vi.mock('../mail-config/emailCounter', () => ({
  checkQuota: mockCheckQuota,
  resolveProviderLimits: mockResolveLimits,
  incrementSendCount: mockIncrement,
}));

vi.mock('../shared/site-settings', () => ({
  getMiscSettings: vi.fn().mockResolvedValue({ showPoweredBy: false }),
  getSiteConfig: mockGetSiteConfig,
}));

vi.mock('../shared/html-document', () => ({ POWERED_BY_EMAIL_HTML: '<!--pb-->' }));

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockTransportSend })) },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: vi.fn(() => ({ seconds: 100, nanoseconds: 0 })),
    fromMillis: vi.fn((ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0, __ms: ms })),
  },
}));

import { sendMail } from '../mail-config/mailConfig.js';

function smtpSettings(overrides: Record<string, any> = {}) {
  return {
    isEnabled: true,
    activeProvider: 'smtp',
    smtp: { host: 'smtp.test', port: 587, user: 'u', password: 'p' },
    unsubscribeSecret: 'sekret',
    ...overrides,
  };
}

function baseLog(overrides: Record<string, any> = {}) {
  return {
    senderEmail: 's@site.com',
    senderName: 'Site',
    toName: 'User',
    toEmail: 'user@example.com',
    subject: 'Hi',
    template: '<p>hi</p>',
    text: 't',
    type: 'x',
    category: 'transactional',
    attempts: 0,
    maxAttempts: 3,
    status: 'pending',
    ...overrides,
  };
}

const lastUpdate = () => mockLogUpdate.mock.calls[mockLogUpdate.mock.calls.length - 1][0];

describe('sendMail hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckQuota.mockResolvedValue({ ok: true, dailyCount: 0, hourlyCount: 0 });
    mockResolveLimits.mockReturnValue({ perSecond: 1 });
    mockTransportSend.mockResolvedValue({ messageId: 'mid-1' });
  });

  it('kill-switch off ⇒ marks skipped/email_disabled and never sends', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ isEnabled: false }) });

    await sendMail(baseLog() as any, 'log-1');

    expect(mockTransportSend).not.toHaveBeenCalled();
    expect(lastUpdate()).toMatchObject({ status: 'skipped', skipReason: 'email_disabled' });
  });

  it('kill-switch off ⇒ the skipped log loses its one-time code (it is never retried)', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ isEnabled: false }) });

    await sendMail(baseLog({ otp: '482913' }) as any, 'log-1');

    expect(lastUpdate()).toMatchObject({ status: 'skipped', otp: '••••••' });
  });

  it('quota exhausted ⇒ deferred/quota with nextAttemptAt, no send', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });
    mockCheckQuota.mockResolvedValue({ ok: false, dailyCount: 999, hourlyCount: 0 });

    await sendMail(baseLog() as any, 'log-1');

    expect(mockTransportSend).not.toHaveBeenCalled();
    const upd = lastUpdate();
    expect(upd.status).toBe('deferred');
    expect(upd.skipReason).toBe('quota');
    expect(upd.nextAttemptAt).toBeDefined();
  });

  it('successful send ⇒ status success, attempts incremented to 1', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });

    await sendMail(baseLog() as any, 'log-1');

    expect(mockTransportSend).toHaveBeenCalledTimes(1);
    const upd = lastUpdate();
    expect(upd.status).toBe('success');
    expect(upd.attempts).toBe(1);
    expect(upd.messageId).toBe('mid-1');
    expect(mockIncrement).toHaveBeenCalledWith('smtp');
  });

  it('transient failure below maxAttempts ⇒ retrying with backoff', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });
    mockTransportSend.mockRejectedValue(new Error('smtp down'));

    await sendMail(baseLog({ attempts: 0 }) as any, 'log-1');

    const upd = lastUpdate();
    expect(upd.status).toBe('retrying');
    expect(upd.attempts).toBe(1);
    expect(upd.nextAttemptAt).toBeDefined();
    expect(upd.errorMessage).toContain('smtp down');
  });

  it('transient failure at final attempt ⇒ failed, no nextAttemptAt', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });
    mockTransportSend.mockRejectedValue(new Error('still down'));

    // attempts=2, maxAttempts=3 ⇒ this attempt is the 3rd (final)
    await sendMail(baseLog({ attempts: 2, maxAttempts: 3 }) as any, 'log-1');

    const upd = lastUpdate();
    expect(upd.status).toBe('failed');
    expect(upd.attempts).toBe(3);
    expect(upd.nextAttemptAt).toBeUndefined();
  });

  describe('a one-time code in the log', () => {
    const codeLog = (extra: Record<string, any> = {}) => baseLog({ subject: 'Code ##OTP##', template: '<p>Your code is ##OTP##</p>', otp: '482913', ...extra });

    it('sends the code, then keeps only a placeholder in the log', async () => {
      mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });
      await sendMail(codeLog() as any, 'log-1');
      const sent = mockTransportSend.mock.calls[0][0];
      expect(sent.html).toContain('482913');
      const upd = lastUpdate();
      expect(upd.status).toBe('success');
      expect(upd.otp).toBe('••••••');
      expect(upd.processedTemplate).not.toContain('482913');
      expect(upd.processedTemplate).toContain('Your code is ••••••');
      expect(upd.processedSubject).toBe('Code ••••••');
    });

    it('keeps the code while a retry still needs it, and hides it once it fails for good', async () => {
      mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });
      mockTransportSend.mockRejectedValue(new Error('smtp down'));
      await sendMail(codeLog({ attempts: 0 }) as any, 'log-1');
      expect(lastUpdate().otp).toBeUndefined();
      await sendMail(codeLog({ attempts: 2, maxAttempts: 3 }) as any, 'log-1');
      expect(lastUpdate()).toMatchObject({ status: 'failed', otp: '••••••' });
      expect(lastUpdate().processedTemplate).not.toContain('482913');
    });

    it('keeps the code with the Simulated provider, where Email Logs is the only place to read it', async () => {
      mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ activeProvider: 'debug_log' }) });
      await sendMail(codeLog() as any, 'log-1');
      const upd = lastUpdate();
      expect(upd.otp).toBeUndefined();
      expect(upd.processedTemplate).toContain('482913');
    });

    it('changes nothing for an email with no code', async () => {
      mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });
      await sendMail(baseLog() as any, 'log-1');
      expect(lastUpdate()).not.toHaveProperty('otp');
    });
  });

  it('marketing send carries List-Unsubscribe headers', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });

    await sendMail(baseLog({ category: 'marketing' }) as any, 'log-1');

    const sendArg = mockTransportSend.mock.calls[0][0];
    expect(sendArg.headers['List-Unsubscribe']).toMatch(/^<https?:\/\/.+\/unsubscribe\?e=.+&t=.+>$/);
    expect(sendArg.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('transactional send has no List-Unsubscribe headers', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });

    await sendMail(baseLog({ category: 'transactional' }) as any, 'log-1');

    const sendArg = mockTransportSend.mock.calls[0][0];
    expect(sendArg.headers['List-Unsubscribe']).toBeUndefined();
  });

  it('Debug Provider (Log Only) records success WITHOUT calling a provider or counter', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ activeProvider: 'debug_log' }) });

    await sendMail(baseLog() as any, 'log-1');

    expect(mockTransportSend).not.toHaveBeenCalled();
    expect(mockIncrement).not.toHaveBeenCalled();
    const upd = lastUpdate();
    expect(upd.status).toBe('success');
    expect(upd.logOnly).toBe(true);
    expect(upd.messageId).toBe('debug-log-provider:log-1');
    // The exact composed message is still recorded for inspection.
    expect(upd.processedTemplate).toBeDefined();
    expect(upd.processedSubject).toBeDefined();
  });

  it('Debug Provider skips the quota check (never defers)', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ activeProvider: 'debug_log' }) });
    mockCheckQuota.mockResolvedValue({ ok: false, dailyCount: 999, hourlyCount: 0 });

    await sendMail(baseLog() as any, 'log-1');

    expect(mockCheckQuota).not.toHaveBeenCalled();
    expect(lastUpdate().status).toBe('success');
  });
});

describe('sendMail sender', () => {
  const sentFrom = () => mockTransportSend.mock.calls[0][0].from;
  const resendFrom = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse(fetchMock.mock.calls[0][1].body).from;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckQuota.mockResolvedValue({ ok: true, dailyCount: 0, hourlyCount: 0 });
    mockResolveLimits.mockReturnValue({ perSecond: 1 });
    mockTransportSend.mockResolvedValue({ messageId: 'mid-1' });
    mockGetSiteConfig.mockResolvedValue({ siteName: 'Sunrise Bakery' });
  });

  it("keeps a template's own sender, with no read of the site", async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ senderName: 'Settings Name' }) });

    await sendMail(baseLog({ senderName: 'Own Name' }) as any, 'log-1');

    expect(sentFrom()).toBe('Own Name <s@site.com>');
    expect(mockGetSiteConfig).not.toHaveBeenCalled();
    expect(lastUpdate().senderName).toBeUndefined();
  });

  it('a blank sender takes Settings, Email, and the log records it', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ senderName: 'Settings Name', senderEmail: 'set@site.com' }) });

    await sendMail(baseLog({ senderName: '', senderEmail: '' }) as any, 'log-1');

    expect(sentFrom()).toBe('Settings Name <set@site.com>');
    expect(lastUpdate()).toMatchObject({ status: 'success', senderName: 'Settings Name', senderEmail: 'set@site.com' });
  });

  it("with nothing in Settings, a blank sender takes the site's name", async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });

    await sendMail(baseLog({ senderName: '' }) as any, 'log-1');

    expect(sentFrom()).toBe('Sunrise Bakery <s@site.com>');
  });

  it('the old "Arc CMS" on a template gives way to what the site has named', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ senderName: 'Settings Name' }) });

    await sendMail(baseLog({ senderName: 'Arc CMS' }) as any, 'log-1');

    expect(sentFrom()).toBe('Settings Name <s@site.com>');
  });

  it('"Arc CMS" saved in Settings, Email is what that form shows, so it is what goes out', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ senderName: 'Arc CMS' }) });

    await sendMail(baseLog({ senderName: '' }) as any, 'log-1');

    expect(sentFrom()).toBe('Arc CMS <s@site.com>');
    expect(mockGetSiteConfig).not.toHaveBeenCalled();
  });

  it('with no name anywhere it sends the address alone, never "" <address>', async () => {
    mockGetSiteConfig.mockResolvedValue({ siteName: '' });
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });

    await sendMail(baseLog({ senderName: '' }) as any, 'log-1');

    expect(sentFrom()).toBe('s@site.com');
  });

  it('a site name that cannot be read costs the name, not the email', async () => {
    mockGetSiteConfig.mockRejectedValue(new Error('offline'));
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });

    await sendMail(baseLog({ senderName: '' }) as any, 'log-1');

    expect(sentFrom()).toBe('s@site.com');
    expect(lastUpdate().status).toBe('success');
  });

  it('"Arc CMS" on a template with nothing else named sends the address alone', async () => {
    mockGetSiteConfig.mockResolvedValue({ siteName: '' });
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });

    await sendMail(baseLog({ senderName: 'Arc CMS' }) as any, 'log-1');

    expect(sentFrom()).toBe('s@site.com');
  });

  it('a name from a public form cannot add a recipient', async () => {
    const { createRequire } = await import('node:module');
    const parse = createRequire(import.meta.url)('nodemailer/lib/addressparser');
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });

    await sendMail(baseLog({ toName: 'x", victim@evil.test, "y' }) as any, 'log-1');

    const to = parse(mockTransportSend.mock.calls[0][0].to);
    expect(to).toHaveLength(1);
    expect(to[0].address).toBe('user@example.com');
  });

  it('Gmail takes the same fallback', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ activeProvider: 'gmail', gmail: { user: 'u', password: 'p' } }) });

    await sendMail(baseLog({ senderName: '' }) as any, 'log-1');

    expect(sentFrom()).toBe('Sunrise Bakery <s@site.com>');
  });

  it('Resend takes the same fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r1' }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ activeProvider: 'resend', resend: { apiKey: 'k' } }) });

      await sendMail(baseLog({ senderName: '' }) as any, 'log-1');

      expect(resendFrom(fetchMock)).toBe('Sunrise Bakery <s@site.com>');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the Simulated provider records the name that would have gone out', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings({ activeProvider: 'debug_log' }) });

    await sendMail(baseLog({ senderName: '' }) as any, 'log-1');

    expect(mockTransportSend).not.toHaveBeenCalled();
    expect(lastUpdate()).toMatchObject({ status: 'success', senderName: 'Sunrise Bakery', logOnly: true });
  });

  it('##SENDER_NAME## in the body says the same name', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => smtpSettings() });

    await sendMail(baseLog({ senderName: '', template: '<p>From ##SENDER_NAME##</p>' }) as any, 'log-1');

    expect(mockTransportSend.mock.calls[0][0].html).toContain('From Sunrise Bakery');
  });
});

describe('addressLine', () => {
  it('quotes a name only when the line needs it', async () => {
    const { addressLine } = await import('../email-core/sender.js');
    expect(addressLine('Sunrise Bakery', 'a@b.c')).toBe('Sunrise Bakery <a@b.c>');
    expect(addressLine('सूर्योदय बेकरी', 'a@b.c')).toBe('सूर्योदय बेकरी <a@b.c>');
    expect(addressLine('Sunrise, Inc.', 'a@b.c')).toBe('"Sunrise, Inc." <a@b.c>');
    expect(addressLine('The "Best" Bakery', 'a@b.c')).toBe('"The \\"Best\\" Bakery" <a@b.c>');
    expect(addressLine('  ', 'a@b.c')).toBe('a@b.c');
    expect(addressLine(undefined, 'a@b.c')).toBe('a@b.c');
  });

  it('a line break in a name cannot add a header', async () => {
    const { addressLine } = await import('../email-core/sender.js');
    expect(addressLine('Evil\r\nBcc: x@y.z', 'a@b.c')).toBe('"Evil Bcc: x@y.z" <a@b.c>');
  });
});
