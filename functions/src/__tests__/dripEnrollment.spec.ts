/**
 * Tests for drip enrollment lifecycle (functions/src/email-core/dripEnrollment.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { enrollmentStore, mockCampaignsGet, mockContactsGet, mockCampaignSet, mockEnrollmentUpdate } = vi.hoisted(() => ({
  enrollmentStore: new Map<string, any>(),
  mockCampaignsGet: vi.fn(),
  mockContactsGet: vi.fn(),
  mockCampaignSet: vi.fn().mockResolvedValue(undefined),
  mockEnrollmentUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'DripEnrollments') {
        const chain: any = {
          doc: (id: string) => ({
            id,
            get: async () => ({ exists: enrollmentStore.has(id), data: () => enrollmentStore.get(id) }),
            set: async (d: any) => { enrollmentStore.set(id, d); },
          }),
          where: vi.fn(() => chain),
          get: async () => ({
            docs: [...enrollmentStore.entries()]
              .filter(([, v]) => v.status === 'active')
              .map(([id, v]) => ({ ref: { update: (u: any) => { enrollmentStore.set(id, { ...v, ...u }); return mockEnrollmentUpdate(u); } }, data: () => v })),
          }),
        };
        return chain;
      }
      if (name === 'DripCampaigns') {
        return { where: vi.fn().mockReturnThis(), get: mockCampaignsGet, doc: () => ({ set: mockCampaignSet }) };
      }
      if (name === 'Contacts') {
        return { where: vi.fn().mockReturnValue({ get: mockContactsGet }) };
      }
      return {};
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => 1_000_000 })),
    fromMillis: vi.fn((ms: number) => ({ toMillis: () => ms, __ms: ms })),
  },
  FieldValue: { increment: (n: number) => ({ __inc: n }) },
}));

import { enrollInCampaign, enrollInListCampaigns, exitAllEnrollments, backfillEnrollments } from '../email-core/dripEnrollment.js';

const campaign = (over: any = {}) => ({
  id: 'camp1', name: 'C', listId: 'l1', status: 'active', trigger: 'list_join',
  steps: [{ id: 's0', templateId: 't0', delayHours: 24 }, { id: 's1', templateId: 't1', delayHours: 48 }],
  ...over,
});

describe('dripEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enrollmentStore.clear();
  });

  it('enrolls a contact at step 0 with a computed nextSendAt', async () => {
    const created = await enrollInCampaign(campaign(), 'c1');
    expect(created).toBe(true);
    const enr = enrollmentStore.get('camp1_c1');
    expect(enr.status).toBe('active');
    expect(enr.currentStep).toBe(0);
    expect(enr.nextSendAt.__ms).toBe(1_000_000 + 24 * 3600 * 1000);
  });

  it('does NOT re-enroll a contact who already has an enrollment (completed)', async () => {
    enrollmentStore.set('camp1_c1', { status: 'completed', currentStep: 2 });
    const created = await enrollInCampaign(campaign(), 'c1');
    expect(created).toBe(false);
    expect(enrollmentStore.get('camp1_c1').status).toBe('completed');
  });

  it('does not enroll into a non-active campaign', async () => {
    expect(await enrollInCampaign(campaign({ status: 'draft' }), 'c1')).toBe(false);
  });

  it('enrollInListCampaigns enrolls into each active campaign on the list', async () => {
    mockCampaignsGet.mockResolvedValue({ docs: [{ id: 'camp1', data: () => campaign() }] });
    await enrollInListCampaigns('c1', ['l1']);
    expect(enrollmentStore.get('camp1_c1')?.status).toBe('active');
  });

  it('exitAllEnrollments exits active enrollments with the reason', async () => {
    enrollmentStore.set('camp1_c1', { status: 'active', campaignId: 'camp1', contactId: 'c1' });
    await exitAllEnrollments('c1', 'unsubscribed');
    expect(enrollmentStore.get('camp1_c1').status).toBe('exited');
    expect(enrollmentStore.get('camp1_c1').exitedReason).toBe('unsubscribed');
  });

  it('backfillEnrollments enrolls all current list members', async () => {
    mockContactsGet.mockResolvedValue({ docs: [{ id: 'c1' }, { id: 'c2' }] });
    const n = await backfillEnrollments(campaign());
    expect(n).toBe(2);
    expect(enrollmentStore.get('camp1_c1')?.status).toBe('active');
    expect(enrollmentStore.get('camp1_c2')?.status).toBe('active');
  });
});
