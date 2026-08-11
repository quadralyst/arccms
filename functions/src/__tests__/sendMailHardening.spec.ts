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
} = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockLogUpdate: vi.fn().mockResolvedValue(undefined),
  mockCheckQuota: vi.fn().mockResolvedValue({ ok: true, dailyCount: 0, hourlyCount: 0 }),
  mockResolveLimits: vi.fn().mockReturnValue({ perSecond: 1 }),
  mockIncrement: vi.fn().mockResolvedValue(undefined),
  mockTransportSend: vi.fn().mockResolvedValue({ messageId: 'mid-1' }),
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
