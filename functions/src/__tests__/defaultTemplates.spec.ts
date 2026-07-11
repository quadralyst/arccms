/**
 * Tests for default-template seeding (functions/src/email-core/defaultTemplates.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettingsGet, mockTemplateGet, mockTemplateSet, existingTypes } = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockTemplateGet: vi.fn(),
  mockTemplateSet: vi.fn().mockResolvedValue(undefined),
  existingTypes: new Set<string>(),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'Settings') {
        return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
      }
      if (name === 'EmailTemplate') {
        let capturedType = '';
        const chain: any = {
          where: vi.fn((_f: string, _op: string, value: string) => {
            capturedType = value;
            return chain;
          }),
          limit: vi.fn(() => chain),
          get: vi.fn(async () => {
            mockTemplateGet(capturedType);
            return { empty: !existingTypes.has(capturedType), docs: [] };
          }),
          doc: vi.fn((id: string) => ({ set: (data: any) => mockTemplateSet(id, data) })),
        };
        return chain;
      }
      return {};
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: vi.fn(() => ({ seconds: 0, nanoseconds: 0 })) },
}));

import { ensureDefaultTemplates, DEFAULT_TEMPLATES } from '../email-core/defaultTemplates.js';

describe('ensureDefaultTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existingTypes.clear();
    mockSettingsGet.mockResolvedValue({ data: () => ({ senderName: 'Site', senderEmail: 's@site.com' }) });
    mockTemplateSet.mockResolvedValue(undefined);
  });

  it('covers all 7 Phase 2 template types', () => {
    const types = DEFAULT_TEMPLATES.map((t) => t.type).sort();
    expect(types).toEqual([
      'payment_failed_email',
      'payment_succeeded_email',
      'signup_otp_email',
      'signup_welcome_email',
      'subscription_lifecycle_email',
      'trial_ending_email',
      'updates_ending_email',
    ]);
  });

  it('marks welcome as marketing and the rest transactional', () => {
    const welcome = DEFAULT_TEMPLATES.find((t) => t.type === 'signup_welcome_email');
    expect(welcome?.category).toBe('marketing');
    for (const t of DEFAULT_TEMPLATES.filter((d) => d.type !== 'signup_welcome_email')) {
      expect(t.category).toBe('transactional');
    }
  });

  it('creates every template on a fresh project', async () => {
    const result = await ensureDefaultTemplates();

    expect(result.created.length).toBe(DEFAULT_TEMPLATES.length);
    expect(result.skipped.length).toBe(0);
    expect(mockTemplateSet).toHaveBeenCalledTimes(DEFAULT_TEMPLATES.length);

    // Deterministic doc id == type, active, sender identity baked in.
    const [id, data] = mockTemplateSet.mock.calls[0];
    expect(id).toBe(data.type);
    expect(data.isActive).toBe(true);
    expect(data.senderEmail).toBe('s@site.com');
    expect(data.editorVersion).toBe('html');
  });

  it('is idempotent — a second run creates nothing', async () => {
    // Simulate: after the first run every type now exists.
    DEFAULT_TEMPLATES.forEach((t) => existingTypes.add(t.type));

    const result = await ensureDefaultTemplates();

    expect(result.created).toEqual([]);
    expect(result.skipped.length).toBe(DEFAULT_TEMPLATES.length);
    expect(mockTemplateSet).not.toHaveBeenCalled();
  });

  it('only creates the missing types (partial seed)', async () => {
    existingTypes.add('payment_succeeded_email');
    existingTypes.add('signup_otp_email');

    const result = await ensureDefaultTemplates();

    expect(result.skipped.sort()).toEqual(['payment_succeeded_email', 'signup_otp_email']);
    expect(result.created).not.toContain('payment_succeeded_email');
    expect(mockTemplateSet).toHaveBeenCalledTimes(DEFAULT_TEMPLATES.length - 2);
  });

  it('every marketing template contains the unsubscribe tag', () => {
    for (const t of DEFAULT_TEMPLATES.filter((d) => d.category === 'marketing')) {
      expect(t.body).toContain('##UNSUBSCRIBE_LINK##');
    }
  });
});
