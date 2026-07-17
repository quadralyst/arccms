/**
 * Tests for the drip scheduler (functions/src/email-core/processDripQueue.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockEnrollmentsGet, mockCampaignGet, mockContactGet, mockSettingsGet, mockTemplateGet,
  mockQueueEmail, mockCampaignSet,
} = vi.hoisted(() => ({
  mockEnrollmentsGet: vi.fn(),
  mockCampaignGet: vi.fn(),
  mockContactGet: vi.fn(),
  mockSettingsGet: vi.fn(),
  mockTemplateGet: vi.fn(),
  mockQueueEmail: vi.fn(),
  mockCampaignSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'DripEnrollments') {
        return { where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: mockEnrollmentsGet };
      }
      if (name === 'DripCampaigns') return { doc: vi.fn().mockReturnValue({ get: mockCampaignGet, set: mockCampaignSet }) };
      if (name === 'Contacts') return { doc: vi.fn().mockReturnValue({ get: mockContactGet }) };
      if (name === 'Settings') return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
      if (name === 'EmailTemplate') return { doc: vi.fn().mockReturnValue({ get: mockTemplateGet }) };
      return {};
    }),
  },
}));

vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: vi.fn((_o: any, h: any) => h) }));
vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: vi.fn(() => ({ toMillis: () => 1_000_000 })), fromMillis: vi.fn((ms: number) => ({ __ms: ms })) },
  FieldValue: { increment: (n: number) => ({ __inc: n }) },
}));

import { processDripQueue } from '../email-core/processDripQueue.js';

const handler = processDripQueue as unknown as () => Promise<void>;

function enrollment(over: any = {}) {
  const update = vi.fn().mockResolvedValue(undefined);
  return {
    ref: { update },
    data: () => ({ campaignId: 'camp1', contactId: 'c1', currentStep: 0, status: 'active', ...over }),
  };
}

const campaign = (over: any = {}) => ({
  exists: true,
  id: 'camp1',
  data: () => ({ name: 'C', listId: 'l1', status: 'active', steps: [{ id: 's0', templateId: 't0', delayHours: 1 }, { id: 's1', templateId: 't1', delayHours: 2 }], ...over }),
});

describe('processDripQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCampaignGet.mockResolvedValue(campaign());
    mockContactGet.mockResolvedValue({ data: () => ({ email: 'c1@x.com', listIds: ['l1'], consent: { marketing: 'subscribed' } }) });
    mockSettingsGet.mockResolvedValue({ data: () => ({ isEnabled: true, activeProvider: 'smtp', features: { drips: true } }) });
    mockTemplateGet.mockResolvedValue({ exists: true, data: () => ({ senderEmail: 's', senderName: 'S', subject: 'x', template: 'y', type: 'drip', isActive: true }) });
    mockQueueEmail.mockResolvedValue({ id: 'log', status: 'pending' });
  });

  it('sends the due step and advances to the next step', async () => {
    const e = enrollment({ currentStep: 0 });
    mockEnrollmentsGet.mockResolvedValue({ docs: [e], size: 1 });

    await handler();

    expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ source: 'drip', category: 'marketing' }));
    expect(e.ref.update).toHaveBeenCalledWith(expect.objectContaining({ currentStep: 1 }));
  });

  it('completes the enrollment after the last step', async () => {
    const e = enrollment({ currentStep: 1 }); // last of 2 steps
    mockEnrollmentsGet.mockResolvedValue({ docs: [e], size: 1 });

    await handler();

    expect(mockQueueEmail).toHaveBeenCalled();
    expect(e.ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  it('exits when the contact left the list', async () => {
    mockContactGet.mockResolvedValue({ data: () => ({ email: 'c1@x.com', listIds: ['other'], consent: { marketing: 'subscribed' } }) });
    const e = enrollment();
    mockEnrollmentsGet.mockResolvedValue({ docs: [e], size: 1 });

    await handler();

    expect(mockQueueEmail).not.toHaveBeenCalled();
    expect(e.ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'exited', exitedReason: 'left_list' }));
  });

  it('exits when the contact unsubscribed', async () => {
    mockContactGet.mockResolvedValue({ data: () => ({ email: 'c1@x.com', listIds: ['l1'], consent: { marketing: 'unsubscribed' } }) });
    const e = enrollment();
    mockEnrollmentsGet.mockResolvedValue({ docs: [e], size: 1 });

    await handler();

    expect(e.ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'exited', exitedReason: 'unsubscribed' }));
  });

  it('holds a pending contact instead of exiting — they may still verify (U2)', async () => {
    // queueEmail reports a pending (unconfirmed) address with skipReason
    // 'unsubscribed', same as a real opt-out. Treating that as an opt-out would
    // permanently drop a contact from the campaign at signup, before they ever
    // had the chance to verify. Hold the step instead, exactly like the
    // kill-switch path — nothing is lost, and it sends once they verify.
    mockContactGet.mockResolvedValue({ data: () => ({ email: 'c1@x.com', listIds: ['l1'], consent: { marketing: 'pending' } }) });
    mockQueueEmail.mockResolvedValue({ id: 'log', status: 'skipped', skipReason: 'unsubscribed' });
    const e = enrollment({ currentStep: 0 });
    mockEnrollmentsGet.mockResolvedValue({ docs: [e], size: 1 });

    await handler();

    expect(e.ref.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'exited' }));
    // Held: retried later, step not advanced.
    expect(e.ref.update).toHaveBeenCalledWith(expect.objectContaining({ nextSendAt: expect.anything() }));
    expect(e.ref.update).not.toHaveBeenCalledWith(expect.objectContaining({ currentStep: 1 }));
  });

  it('still exits a genuinely suppressed contact', async () => {
    mockContactGet.mockResolvedValue({ data: () => ({ email: 'c1@x.com', listIds: ['l1'], consent: { marketing: 'subscribed' } }) });
    mockQueueEmail.mockResolvedValue({ id: 'log', status: 'skipped', skipReason: 'suppressed' });
    const e = enrollment();
    mockEnrollmentsGet.mockResolvedValue({ docs: [e], size: 1 });

    await handler();

    expect(e.ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'exited', exitedReason: 'unsubscribed' }));
  });

  it('holds (does not advance) when drips feature is off — step is not lost', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => ({ isEnabled: true, activeProvider: 'smtp', features: { drips: false } }) });
    mockQueueEmail.mockResolvedValue({ id: 'log', status: 'skipped', skipReason: 'feature_disabled' });
    const e = enrollment({ currentStep: 0 });
    mockEnrollmentsGet.mockResolvedValue({ docs: [e], size: 1 });

    await handler();

    // queueEmail was called (writes a skipped log), but currentStep is NOT advanced.
    expect(mockQueueEmail).toHaveBeenCalled();
    const updates = e.ref.update.mock.calls.map((c: any[]) => c[0]);
    expect(updates.every((u: any) => u.currentStep === undefined && u.status !== 'completed')).toBe(true);
    // Only nextSendAt was pushed out (hold).
    expect(updates.some((u: any) => u.nextSendAt !== undefined)).toBe(true);
  });

  it('holds a paused campaign without sending', async () => {
    mockCampaignGet.mockResolvedValue(campaign({ status: 'paused' }));
    const e = enrollment();
    mockEnrollmentsGet.mockResolvedValue({ docs: [e], size: 1 });

    await handler();

    expect(mockQueueEmail).not.toHaveBeenCalled();
    expect(e.ref.update).not.toHaveBeenCalled();
  });

  it('exits an archived campaign enrollment', async () => {
    mockCampaignGet.mockResolvedValue(campaign({ status: 'archived' }));
    const e = enrollment();
    mockEnrollmentsGet.mockResolvedValue({ docs: [e], size: 1 });

    await handler();

    expect(e.ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'exited', exitedReason: 'archived' }));
  });
});
