/**
 * Tests for the queueEmail() chokepoint (functions/src/email-core/queueEmail.ts).
 *
 * Verifies the gating order and that every blocked send writes an auditable
 * EmailLogs doc with the correct status + skipReason (never silently dropped).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdd, mockSettingsGet, mockSuppressionGet, mockGetContactConsent, mockDisabled } = vi.hoisted(() => ({
  mockAdd: vi.fn().mockResolvedValue({ id: 'log-1' }),
  mockSettingsGet: vi.fn(),
  mockSuppressionGet: vi.fn(),
  mockGetContactConsent: vi.fn().mockResolvedValue(null),
  // Box so tests can flip the admin disable flag (U4) without re-mocking.
  mockDisabled: { value: false },
}));

// Phase 3: the marketing gate consults Contacts consent (fallback to isSubscribed).
// U4: consent + the admin `disabled` flag are read together in getContactGateState,
// derived here from the same consent mock so existing consent tests are unchanged.
vi.mock('../email-core/contacts', () => ({
  getContactConsent: mockGetContactConsent,
  getContactGateState: async (emailHash: string) => {
    const consent = await mockGetContactConsent(emailHash);
    return { exists: consent !== null, consent, disabled: mockDisabled.value };
  },
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'Settings') {
        return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
      }
      if (name === 'Suppression') {
        return { doc: vi.fn().mockReturnValue({ get: mockSuppressionGet }) };
      }
      if (name === 'EmailLogs') {
        return { add: mockAdd };
      }
      return {};
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: vi.fn(() => ({ seconds: 0, nanoseconds: 0 })),
    fromMillis: vi.fn((ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 })),
  },
}));

import { queueEmail } from '../email-core/queueEmail.js';

/** Fully-enabled settings with all feature toggles on. */
function enabledSettings(overrides: Record<string, any> = {}) {
  return {
    isEnabled: true,
    activeProvider: 'smtp',
    features: {
      waitlistEmails: true,
      authEmails: true,
      paymentEmails: true,
      notificationEmails: true,
      broadcasts: true,
      drips: true,
      adminAlerts: true,
    },
    ...overrides,
  };
}

const baseParams = {
  source: 'waitlist' as const,
  category: 'transactional' as const,
  toEmail: 'user@example.com',
  toName: 'User',
  senderEmail: 's@site.com',
  senderName: 'Site',
  subject: 'Hi',
  template: '<p>hi</p>',
  type: 'waitlist_verify_otp_email',
};

function lastAddArg() {
  return mockAdd.mock.calls[mockAdd.mock.calls.length - 1][0];
}

describe('queueEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdd.mockResolvedValue({ id: 'log-1' });
    mockSuppressionGet.mockResolvedValue({ exists: false, data: () => undefined });
    mockGetContactConsent.mockResolvedValue(null); // no contact → fall back to isSubscribed
    mockDisabled.value = false;
  });

  describe('admin-disabled contacts (U4 / U-D12)', () => {
    it('blocks a marketing email with skipReason contact_disabled', async () => {
      mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });
      mockGetContactConsent.mockResolvedValue('subscribed');
      mockDisabled.value = true;

      const res = await queueEmail({ ...baseParams, category: 'marketing' });

      expect(res.status).toBe('skipped');
      expect(res.skipReason).toBe('contact_disabled');
    });

    it('blocks transactional email too — the switch is absolute', async () => {
      // Stronger than consent by design: an admin-disabled contact receives
      // nothing, including a signup OTP, until they are re-enabled.
      mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });
      mockGetContactConsent.mockResolvedValue('subscribed');
      mockDisabled.value = true;

      const res = await queueEmail({ ...baseParams, category: 'transactional' });

      expect(res.status).toBe('skipped');
      expect(res.skipReason).toBe('contact_disabled');
    });

    it('writes an auditable log rather than dropping the send silently', async () => {
      mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });
      mockDisabled.value = true;

      await queueEmail({ ...baseParams, category: 'marketing' });

      expect(lastAddArg()).toMatchObject({ status: 'skipped', skipReason: 'contact_disabled' });
    });

    it('re-enabling restores delivery', async () => {
      mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });
      mockGetContactConsent.mockResolvedValue('subscribed');
      mockDisabled.value = false;

      const res = await queueEmail({ ...baseParams, category: 'marketing' });

      expect(res.status).toBe('pending');
    });

    it('takes precedence over the consent gate', async () => {
      // Both would block; the reason must be the admin action, so the audit
      // trail shows why it was really stopped.
      mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });
      mockGetContactConsent.mockResolvedValue('unsubscribed');
      mockDisabled.value = true;

      const res = await queueEmail({ ...baseParams, category: 'marketing' });

      expect(res.skipReason).toBe('contact_disabled');
    });
  });

  it('writes a pending log when all gates pass', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });

    const res = await queueEmail(baseParams);

    expect(res.status).toBe('pending');
    expect(res.id).toBe('log-1');
    const doc = lastAddArg();
    expect(doc.status).toBe('pending');
    expect(doc.category).toBe('transactional');
    expect(doc.source).toBe('waitlist');
    expect(doc.attempts).toBe(0);
    expect(doc.maxAttempts).toBe(3);
    expect(doc.emailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.skipReason).toBeUndefined();
  });

  it('gate 1: master kill-switch off ⇒ skipped/email_disabled', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings({ isEnabled: false }) });

    const res = await queueEmail(baseParams);

    expect(res.status).toBe('skipped');
    expect(res.skipReason).toBe('email_disabled');
    expect(lastAddArg().status).toBe('skipped');
    expect(lastAddArg().skipReason).toBe('email_disabled');
  });

  it('gate 1: missing provider ⇒ skipped/email_disabled', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings({ activeProvider: undefined }) });

    const res = await queueEmail(baseParams);

    expect(res.skipReason).toBe('email_disabled');
  });

  it('gate 2: feature toggle off ⇒ skipped/feature_disabled', async () => {
    mockSettingsGet.mockResolvedValue({
      data: () => enabledSettings({ features: { waitlistEmails: false } }),
    });

    const res = await queueEmail(baseParams);

    expect(res.status).toBe('skipped');
    expect(res.skipReason).toBe('feature_disabled');
  });

  it('gate 2: each source maps to its own feature key', async () => {
    mockSettingsGet.mockResolvedValue({
      data: () => enabledSettings({ features: { paymentEmails: false, waitlistEmails: true } }),
    });

    // payment source is gated by paymentEmails=false
    const blocked = await queueEmail({ ...baseParams, source: 'payment', type: 'payment_succeeded_email' });
    expect(blocked.skipReason).toBe('feature_disabled');

    // waitlist source still passes (waitlistEmails=true)
    const ok = await queueEmail(baseParams);
    expect(ok.status).toBe('pending');
  });

  it('gate 2: event/test sources have no feature gate', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings({ features: {} }) });

    const res = await queueEmail({ ...baseParams, source: 'test', type: 'test' });
    expect(res.status).toBe('pending');
  });

  it('gate 3: templateIsActive=false ⇒ skipped/template_inactive', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });

    const res = await queueEmail({ ...baseParams, templateIsActive: false });

    expect(res.status).toBe('skipped');
    expect(res.skipReason).toBe('template_inactive');
  });

  it('gate 4: marketing + isSubscribed=false ⇒ skipped/unsubscribed', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });

    const res = await queueEmail({
      ...baseParams,
      category: 'marketing',
      type: 'waitlist_welcome_email',
      isSubscribed: false,
    });

    expect(res.status).toBe('skipped');
    expect(res.skipReason).toBe('unsubscribed');
  });

  it('gate 4: Contacts consent overrides the isSubscribed fallback (unsubscribed)', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });
    mockGetContactConsent.mockResolvedValue('unsubscribed');

    const res = await queueEmail({
      ...baseParams,
      category: 'marketing',
      type: 'waitlist_welcome_email',
      isSubscribed: true, // legacy says subscribed, but the Contact says otherwise
    });

    expect(res.status).toBe('skipped');
    expect(res.skipReason).toBe('unsubscribed');
  });

  it('gate 4: Contacts consent subscribed passes even when isSubscribed is unset', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });
    mockGetContactConsent.mockResolvedValue('subscribed');

    const res = await queueEmail({ ...baseParams, category: 'marketing', type: 'waitlist_welcome_email' });
    expect(res.status).toBe('pending');
  });

  it('gate 4: pending consent blocks marketing even when isSubscribed says true (U2)', async () => {
    // A pending contact signed up but never confirmed their address. U2 makes
    // this the normal state between signup and verification, so the marketing
    // gate must treat it as not-mailable rather than trusting the legacy
    // isSubscribed flag the signup wrote.
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });
    mockGetContactConsent.mockResolvedValue('pending');

    const res = await queueEmail({
      ...baseParams,
      category: 'marketing',
      type: 'waitlist_welcome_email',
      isSubscribed: true,
    });

    expect(res.status).toBe('skipped');
    expect(res.skipReason).toBe('unsubscribed');
  });

  it('gate 4: pending consent still lets transactional mail through (U2)', async () => {
    // Verification OTPs are transactional — a pending contact must still be able
    // to receive the very email that lets them verify.
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });
    mockGetContactConsent.mockResolvedValue('pending');

    const res = await queueEmail({ ...baseParams, category: 'transactional' });

    expect(res.status).toBe('pending');
  });

  it('gate 4: transactional ignores consent', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });

    const res = await queueEmail({ ...baseParams, category: 'transactional', isSubscribed: false });

    expect(res.status).toBe('pending');
  });

  it('gate 5: marketing blocked by ANY suppression reason ⇒ suppressed', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });
    mockSuppressionGet.mockResolvedValue({ exists: true, data: () => ({ reason: 'unsubscribe' }) });

    const res = await queueEmail({
      ...baseParams,
      category: 'marketing',
      type: 'waitlist_welcome_email',
      isSubscribed: true,
    });

    expect(res.status).toBe('suppressed');
    expect(res.skipReason).toBe('suppressed');
  });

  it('gate 5: transactional blocked only by bounce/complaint', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings() });

    // soft reason (unsubscribe) does NOT block transactional
    mockSuppressionGet.mockResolvedValue({ exists: true, data: () => ({ reason: 'unsubscribe' }) });
    const ok = await queueEmail({ ...baseParams, category: 'transactional' });
    expect(ok.status).toBe('pending');

    // hard bounce DOES block transactional
    mockSuppressionGet.mockResolvedValue({ exists: true, data: () => ({ reason: 'bounce' }) });
    const blocked = await queueEmail({ ...baseParams, category: 'transactional' });
    expect(blocked.status).toBe('suppressed');
  });

  it('uses provided emailSettings without reading Settings', async () => {
    const res = await queueEmail({ ...baseParams, emailSettings: enabledSettings() as any });

    expect(res.status).toBe('pending');
    expect(mockSettingsGet).not.toHaveBeenCalled();
  });

  it('resolves bcc from settings when not provided', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => enabledSettings({ bccEmail: 'admin@site.com' }) });

    await queueEmail(baseParams);

    expect(lastAddArg().bcc).toBe('admin@site.com');
  });
});
