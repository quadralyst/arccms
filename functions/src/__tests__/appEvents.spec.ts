/**
 * Tests for the event bus (functions/src/email-core/appEvents.ts) — verify #7.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockUpdate, mockAdd, mockMappingGet, mockUsersGet, mockTemplateGet,
  mockCreateNotif, mockQueueEmail, mockUpsert, mockAddLists, mockRemoveLists,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn().mockResolvedValue(undefined),
  mockAdd: vi.fn().mockResolvedValue({ id: 'ev1' }),
  mockMappingGet: vi.fn(),
  mockUsersGet: vi.fn(),
  mockTemplateGet: vi.fn(),
  mockCreateNotif: vi.fn().mockResolvedValue('n1'),
  mockQueueEmail: vi.fn().mockResolvedValue({ id: 'log1', status: 'pending' }),
  mockUpsert: vi.fn().mockResolvedValue({ emailHash: 'h', created: true }),
  mockAddLists: vi.fn().mockResolvedValue(['all-users']),
  mockRemoveLists: vi.fn().mockResolvedValue([]),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'AppEvents') return { doc: vi.fn().mockReturnValue({ update: mockUpdate }), add: mockAdd };
      if (name === 'Settings') return { doc: vi.fn().mockReturnValue({ get: mockMappingGet }) };
      if (name === 'users') return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockUsersGet }) }) };
      if (name === 'EmailTemplate') return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockTemplateGet }) }) };
      return {};
    }),
  },
}));

vi.mock('../email-core/notifications', () => ({ createNotification: mockCreateNotif }));
vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));
vi.mock('../email-core/contacts', () => ({
  upsertContact: mockUpsert, addContactToLists: mockAddLists, removeContactFromLists: mockRemoveLists,
}));
vi.mock('../constant', () => ({ constant: { isProduction: false, live_url: 'https://x/', local_url: 'http://l/' } }));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: vi.fn((_p: string, h: any) => h) }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: vi.fn(() => ({ seconds: 0 })) } }));

import { onAppEventCreate } from '../email-core/appEvents.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';

const handler = onAppEventCreate as unknown as (e: any) => Promise<void>;
const event = (data: any) => ({ data: { data: () => data }, params: { id: 'ev1' } });
const lastResults = () => mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0].results;

function mappings(obj: any) {
  mockMappingGet.mockResolvedValue({ data: () => ({ mappings: obj }) });
}

describe('onAppEventCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsersGet.mockResolvedValue({ empty: false, docs: [{ data: () => ({ email: 'u@x.com' }) }] });
    mockTemplateGet.mockResolvedValue({ empty: false, docs: [{ data: () => ({ senderEmail: 's', senderName: 'S', subject: 'x', template: 'y', isActive: true }) }] });
  });

  it('unknown event type ⇒ processed with no_mapping, no crash', async () => {
    mappings({});
    await handler(event({ type: 'mystery.thing', userId: 'u1' }));
    expect(lastResults()).toEqual({ status: 'no_mapping' });
  });

  it('disabled mapping ⇒ processed disabled', async () => {
    mappings({ 'user.signed_up': { enabled: false, addToLists: ['all-users'] } });
    await handler(event({ type: 'user.signed_up', userId: 'u1', contactEmail: 'u@x.com' }));
    expect(lastResults()).toEqual({ status: 'disabled' });
    expect(mockAddLists).not.toHaveBeenCalled();
  });

  it('already processed ⇒ no-op', async () => {
    await handler(event({ type: 'x', processed: true }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('enabled mapping runs notification + list add, marks processed ok', async () => {
    mappings({
      'custom.thing': {
        enabled: true,
        createNotification: { typeKey: 'announcement', titleTemplate: 'Hi ##NAME##', bodyTemplate: 'Body' },
        addToLists: ['vip'],
      },
    });
    await handler(event({ type: 'custom.thing', userId: 'u1', contactEmail: 'u@x.com', data: { NAME: 'Ada' } }));

    expect(mockCreateNotif).toHaveBeenCalledWith(expect.objectContaining({ title: 'Hi Ada', type: 'announcement' }));
    expect(mockAddLists).toHaveBeenCalledWith(computeEmailHash('u@x.com'), ['vip']);
    expect(lastResults()).toMatchObject({ status: 'ok', notification: 'n1' });
  });

  it('enabled mapping can queue an email', async () => {
    mappings({ 'custom.mail': { enabled: true, sendEmail: { templateType: 'notification_generic_email', category: 'transactional' } } });
    await handler(event({ type: 'custom.mail', contactEmail: 'u@x.com', data: {} }));
    expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ source: 'event' }));
    expect(lastResults()).toMatchObject({ status: 'ok', email: 'pending' });
  });
});
