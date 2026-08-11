/**
 * Decision-matrix tests for onNotificationCreate
 * (functions/src/email-core/onNotificationCreate.ts) — spec §Phase-5 verify #1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockUpdate, mockGetConfig, mockQueueEmail, mockEnsureDefaults,
  mockUsersGet, mockContactGet, mockSettingsGet, mockTemplateGet,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn().mockResolvedValue(undefined),
  mockGetConfig: vi.fn(),
  mockQueueEmail: vi.fn().mockResolvedValue({ id: 'log-1', status: 'pending' }),
  mockEnsureDefaults: vi.fn().mockResolvedValue(undefined),
  mockUsersGet: vi.fn(),
  mockContactGet: vi.fn(),
  mockSettingsGet: vi.fn(),
  mockTemplateGet: vi.fn(),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'Notifications') return { doc: vi.fn().mockReturnValue({ update: mockUpdate }) };
      if (name === 'users') return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockUsersGet }) }) };
      if (name === 'Contacts') return { doc: vi.fn().mockReturnValue({ get: mockContactGet }) };
      if (name === 'Settings') return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
      if (name === 'EmailTemplate') return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockTemplateGet }) }) };
      return {};
    }),
  },
}));

vi.mock('../email-core/notifications', () => ({ getNotificationTypeConfig: mockGetConfig }));
vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));
vi.mock('../email-core/defaultTemplates', () => ({ ensureDefaultTemplates: mockEnsureDefaults }));
vi.mock('../constant', () => ({ constant: { isProduction: false, live_url: 'https://x/', local_url: 'http://l/' } }));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: vi.fn((_p: string, h: any) => h) }));

import { onNotificationCreate } from '../email-core/onNotificationCreate.js';

const handler = onNotificationCreate as unknown as (e: any) => Promise<void>;

function event(notif: any) {
  return { data: { data: () => notif }, params: { id: 'n1' } };
}
const lastDelivery = () => mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0].emailDelivery;

const CONFIGURABLE = { label: '', description: '', category: 'transactional', defaultChannels: { inApp: true, email: true }, userConfigurable: true, enabled: true };
const NON_CONFIGURABLE = { ...CONFIGURABLE, userConfigurable: false };

describe('onNotificationCreate decision matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue(NON_CONFIGURABLE);
    mockUsersGet.mockResolvedValue({ empty: false, docs: [{ data: () => ({ email: 'u@x.com' }) }] });
    mockContactGet.mockResolvedValue({ data: () => ({}) });
    mockSettingsGet.mockResolvedValue({ data: () => ({ isEnabled: true, activeProvider: 'smtp', features: { notificationEmails: true } }) });
    mockTemplateGet.mockResolvedValue({ empty: false, docs: [{ data: () => ({ senderEmail: 's', senderName: 'S', subject: 'x', template: 'y', isActive: true }) }] });
    mockQueueEmail.mockResolvedValue({ id: 'log-1', status: 'pending' });
  });

  it('all on ⇒ queues email, records requested + emailLogId', async () => {
    await handler(event({ userId: 'u1', type: 'payment_succeeded', title: 'T', body: 'B' }));
    expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ source: 'notification', toEmail: 'u@x.com' }));
    expect(lastDelivery()).toEqual({ requested: true, emailLogId: 'log-1' });
  });

  it('type email channel off ⇒ type_channel_off, no queue', async () => {
    mockGetConfig.mockResolvedValue({ ...NON_CONFIGURABLE, defaultChannels: { inApp: true, email: false } });
    await handler(event({ userId: 'u1', type: 't', title: 'T', body: 'B' }));
    expect(mockQueueEmail).not.toHaveBeenCalled();
    expect(lastDelivery()).toEqual({ requested: false, skippedReason: 'type_channel_off' });
  });

  it('user pref off (configurable type) ⇒ user_pref_off', async () => {
    mockGetConfig.mockResolvedValue(CONFIGURABLE);
    mockContactGet.mockResolvedValue({ data: () => ({ notificationPrefs: { subscription_changed: { email: false } } }) });
    await handler(event({ userId: 'u1', type: 'subscription_changed', title: 'T', body: 'B' }));
    expect(mockQueueEmail).not.toHaveBeenCalled();
    expect(lastDelivery()).toEqual({ requested: false, skippedReason: 'user_pref_off' });
  });

  it('non-configurable type ignores user pref', async () => {
    mockContactGet.mockResolvedValue({ data: () => ({ notificationPrefs: { payment_succeeded: { email: false } } }) });
    await handler(event({ userId: 'u1', type: 'payment_succeeded', title: 'T', body: 'B' }));
    expect(mockQueueEmail).toHaveBeenCalled();
  });

  it('feature disabled ⇒ feature_disabled', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => ({ isEnabled: true, activeProvider: 'smtp', features: { notificationEmails: false } }) });
    await handler(event({ userId: 'u1', type: 'payment_succeeded', title: 'T', body: 'B' }));
    expect(mockQueueEmail).not.toHaveBeenCalled();
    expect(lastDelivery()).toEqual({ requested: false, skippedReason: 'feature_disabled' });
  });

  it('master off ⇒ queueEmail skips; records skipReason from queueEmail', async () => {
    mockQueueEmail.mockResolvedValue({ id: 'log-2', status: 'skipped', skipReason: 'email_disabled' });
    await handler(event({ userId: 'u1', type: 'payment_succeeded', title: 'T', body: 'B' }));
    expect(lastDelivery()).toEqual({ requested: true, emailLogId: 'log-2', skippedReason: 'email_disabled' });
  });

  it('suppressEmail on the notification ⇒ suppressed_by_sender', async () => {
    await handler(event({ userId: 'u1', type: 'announcement', title: 'T', body: 'B', suppressEmail: true }));
    expect(mockQueueEmail).not.toHaveBeenCalled();
    expect(lastDelivery()).toEqual({ requested: false, skippedReason: 'suppressed_by_sender' });
  });

  it('unknown type ⇒ unknown_type, no queue', async () => {
    mockGetConfig.mockResolvedValue(null);
    await handler(event({ userId: 'u1', type: 'mystery', title: 'T', body: 'B' }));
    expect(mockQueueEmail).not.toHaveBeenCalled();
    expect(lastDelivery()).toEqual({ requested: false, skippedReason: 'unknown_type' });
  });

  it('no user email ⇒ no_email', async () => {
    mockUsersGet.mockResolvedValue({ empty: true, docs: [] });
    await handler(event({ userId: 'u1', type: 'payment_succeeded', title: 'T', body: 'B' }));
    expect(lastDelivery()).toEqual({ requested: false, skippedReason: 'no_email' });
  });
});
