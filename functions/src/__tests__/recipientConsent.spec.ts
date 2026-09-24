/** Consent for contacts and app users behind one email hash (CO6.5a). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
    const logs: Array<Record<string, unknown>> = [];
    const contacts = new Map<string, Record<string, unknown>>();
    const states = new Map<string, Record<string, unknown>>();
    const setContactConsent = vi.fn(async () => undefined);
    const db = {
        collection: vi.fn((name: string) => {
            if (name === 'EmailLogs') {
                return { where: vi.fn((_f: string, _o: string, v: string) => ({ limit: vi.fn(() => ({
                    get: vi.fn(async () => ({ docs: logs.filter((l) => l['emailHash'] === v).map((l) => ({ data: () => l })) })),
                })) })) };
            }
            const store = name === 'Contacts' ? contacts : states;
            return { doc: vi.fn((id: string) => ({
                get: vi.fn(async () => ({ exists: store.has(id), data: () => store.get(id) })),
                set: vi.fn(async (d: Record<string, unknown>) => { store.set(id, { ...store.get(id), ...d }); }),
            })) };
        }),
    };
    return { logs, contacts, states, setContactConsent, db };
});

vi.mock('../init', () => ({ db: m.db }));
vi.mock('../email-core/contacts', () => ({ setContactConsent: m.setContactConsent }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: vi.fn(() => 'now') } }));

import { getRecipientConsent, setRecipientConsent } from '../email-core/recipientConsent.js';

describe('recipient consent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.logs.length = 0;
        m.contacts.clear();
        m.states.clear();
    });

    it('an app user unsubscribing updates their record and never creates a contact', async () => {
        m.logs.push({ emailHash: 'e1', appUserId: 'h1' }, { emailHash: 'e1', appUserId: 'h1' });
        await setRecipientConsent('e1', 'unsubscribed', 'a@x.com');
        expect(m.states.get('h1')).toEqual({ consent: 'unsubscribed', consentChangedAt: 'now' });
        expect(m.setContactConsent).not.toHaveBeenCalled();
        expect(await getRecipientConsent('e1')).toBe('unsubscribed');
    });

    it('updates both when the address is a contact and an app user', async () => {
        m.logs.push({ emailHash: 'e1', appUserId: 'h1' });
        m.contacts.set('e1', { consent: { marketing: 'subscribed' } });
        await setRecipientConsent('e1', 'unsubscribed', 'a@x.com');
        expect(m.setContactConsent).toHaveBeenCalledWith('e1', 'unsubscribed', 'a@x.com');
        expect(m.states.get('h1')?.['consent']).toBe('unsubscribed');
    });

    it('behaves as before for everyone else: the contact is written', async () => {
        m.logs.push({ emailHash: 'e1' });
        await setRecipientConsent('e1', 'subscribed');
        expect(m.setContactConsent).toHaveBeenCalledWith('e1', 'subscribed', undefined);
        expect(m.states.size).toBe(0);
    });

    it('shows the contact\'s consent first, then an app user\'s, else nothing', async () => {
        expect(await getRecipientConsent('e1')).toBeNull();
        m.logs.push({ emailHash: 'e1', appUserId: 'h1' });
        expect(await getRecipientConsent('e1')).toBe('subscribed');
        m.contacts.set('e1', { consent: { marketing: 'pending' } });
        expect(await getRecipientConsent('e1')).toBe('pending');
    });
});
