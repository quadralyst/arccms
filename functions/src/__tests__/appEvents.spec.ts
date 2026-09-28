/**
 * Tests for the event bus (functions/src/email-core/appEvents.ts) — verify #7.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockUpdate, mockAdd, mockMappingGet, mockUsersGet, mockTemplateGet,
  mockCreateNotif, mockQueueEmail, mockUpsert, mockAddLists, mockRemoveLists, mockCreate, mockStateGet,
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
  mockCreate: vi.fn().mockResolvedValue(undefined),
  mockStateGet: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'AppEvents') return { doc: vi.fn().mockReturnValue({ update: mockUpdate, create: mockCreate }), add: mockAdd };
      if (name === 'AppAudience') return { doc: vi.fn().mockReturnValue({ get: mockStateGet }) };
      if (name === 'Settings') return { doc: vi.fn().mockReturnValue({ get: mockMappingGet }) };
      if (name === 'users') return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockUsersGet }) }) };
      if (name === 'EmailTemplate') return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockTemplateGet }) }) };
      return {};
    }),
  },
}));

vi.mock('../email-core/notifications', () => ({ createNotification: mockCreateNotif }));
vi.mock('../app-audience/mergeFields', () => ({ readAppMergeFields: vi.fn(async (docId: string) => (docId ? { isPro: 'true' } : {})) }));
vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));
vi.mock('../email-core/contacts', () => ({
  upsertContact: mockUpsert, addContactToLists: mockAddLists, removeContactFromLists: mockRemoveLists,
}));
vi.mock('../constant', () => ({ constant: { isProduction: false, live_url: 'https://x/', local_url: 'http://l/' } }));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: vi.fn((_p: string, h: any) => h) }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: vi.fn(() => ({ seconds: 0 })) } }));

import { emitAppEvent, onAppEventCreate } from '../email-core/appEvents.js';
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

  describe('rules (CO6.4)', () => {
    const plan = {
      enabled: true,
      rules: [
        { name: 'Upgraded', when: { to: { equals: true } }, sendEmail: { templateType: 'app_user_upgraded', category: 'transactional' } },
        { name: 'Downgraded', when: { to: { equals: false } }, sendEmail: { templateType: 'app_user_downgraded', category: 'transactional' } },
      ],
    };

    it('runs only the rule whose condition matches, keyed by rule name', async () => {
      mappings({ 'app_user.changed.isPro': plan });
      await handler(event({ type: 'app_user.changed.isPro', contactEmail: 'a@x.com', appUserId: 'h1', data: { field: 'isPro', from: 'false', to: 'true', name: 'Asha' } }));
      expect(mockQueueEmail).toHaveBeenCalledTimes(1);
      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ type: 'app_user_upgraded', toEmail: 'a@x.com', toName: 'Asha' }));
      expect(lastResults()).toEqual({ status: 'ok', Upgraded: { email: 'pending' } });
    });

    it('records when no rule matches', async () => {
      mappings({ 'app_user.changed.isPro': plan });
      await handler(event({ type: 'app_user.changed.isPro', contactEmail: 'a@x.com', appUserId: 'h1', data: { from: 'true', to: 'maybe' } }));
      expect(mockQueueEmail).not.toHaveBeenCalled();
      expect(lastResults()).toEqual({ status: 'no_matching_rule' });
    });

    it('skips a disabled rule', async () => {
      mappings({ 'x.y': { enabled: true, rules: [{ name: 'Off', enabled: false, sendEmail: { templateType: 't', category: 'transactional' } }] } });
      await handler(event({ type: 'x.y', contactEmail: 'a@x.com', data: {} }));
      expect(lastResults()).toEqual({ status: 'no_matching_rule' });
    });

    it('passes an app user\'s ArcCMS consent to the send', async () => {
      mockStateGet.mockResolvedValueOnce({ exists: true, data: () => ({ consent: 'unsubscribed' }) });
      mappings({ 'app_user.created': { enabled: true, sendEmail: { templateType: 't', category: 'marketing' } } });
      await handler(event({ type: 'app_user.created', contactEmail: 'a@x.com', appUserId: 'h1', data: {} }));
      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ isSubscribed: false, category: 'marketing' }));
    });

    it('sends an app user\'s host fields with the email, for ##APP.<path>## tags', async () => {
      mappings({ 'app_user.created': { enabled: true, sendEmail: { templateType: 't', category: 'transactional' } } });
      await handler(event({ type: 'app_user.created', contactEmail: 'a@x.com', appUserId: 'h1', data: { docId: 'u1' } }));
      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ appUser: { id: 'h1', docId: 'u1', fields: { isPro: 'true' } } }));
    });

    it('never adds an app user to a list, since that would copy them into Contacts', async () => {
      mappings({ 'app_user.created': { enabled: true, addToLists: ['vip'] } });
      await handler(event({ type: 'app_user.created', contactEmail: 'a@x.com', appUserId: 'h1', data: {} }));
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(mockAddLists).not.toHaveBeenCalled();
      expect(lastResults()).toEqual({ status: 'ok', lists: 'not_applicable' });
    });
  });

  describe('emitAppEvent with a stable id', () => {
    it('creates the event under that id', async () => {
      expect(await emitAppEvent('app_user.created', { appUserId: 'h1' }, { id: 'e1.created' })).toBe('e1.created');
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ type: 'app_user.created', appUserId: 'h1', processed: false }));
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('treats an id that already exists as done, so a repeated delivery acts once', async () => {
      mockCreate.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 6 }));
      await expect(emitAppEvent('x', {}, { id: 'e1' })).resolves.toBe('e1');
    });

    it('still fails on any other error', async () => {
      mockCreate.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 14 }));
      await expect(emitAppEvent('x', {}, { id: 'e1' })).rejects.toThrow('boom');
    });
  });
});
