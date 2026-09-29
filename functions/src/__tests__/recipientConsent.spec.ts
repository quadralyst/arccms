/** Consent for contacts and app users behind one email hash (CO6.5a). */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const m = vi.hoisted(() => {
    const logs: Array<Record<string, unknown>> = [];
    const contacts = new Map<string, Record<string, unknown>>();
    const states = new Map<string, Record<string, unknown>>();
    const hostDocs = new Map<string, Record<string, unknown>>();
    const host = {
        doc: vi.fn((id: string) => ({ get: vi.fn(async () => ({ id, exists: hostDocs.has(id), data: () => hostDocs.get(id) })) })),
        where: vi.fn((field: string, _op: string, value: unknown) => ({ limit: vi.fn(() => ({
            get: vi.fn(async () => ({ docs: [...hostDocs].filter(([, d]) => d[field] === value).map(([id, d]) => ({ id, data: () => d })) })),
        })) })),
    };
    const setContactConsent = vi.fn(async () => undefined);
    const exitAllEnrollments = vi.fn(async () => undefined);
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
    return { logs, contacts, states, hostDocs, host, setContactConsent, exitAllEnrollments, db };
});

vi.mock('../init', () => ({ db: m.db, firestoreFor: vi.fn(() => ({ collection: vi.fn(() => m.host) })) }));
vi.mock('../email-core/contacts', () => ({ setContactConsent: m.setContactConsent }));
vi.mock('../email-core/dripEnrollment', () => ({ appContactId: (id: string) => `app_${id}`, exitAllEnrollments: m.exitAllEnrollments }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: vi.fn(() => 'now') } }));

import { appUserIdsForEmailHash, getRecipientConsent, setRecipientConsent } from '../email-core/recipientConsent.js';
import { appUserStateId } from '../app-audience/state.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';

describe('recipient consent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.logs.length = 0;
        m.contacts.clear();
        m.states.clear();
        m.hostDocs.clear();
        delete process.env.ARC_APP_USERS_PATH;
        delete process.env.ARC_APP_USERS_DATABASE;
    });

    // Other test files may run in this worker next: leave no host app configured.
    afterAll(() => {
        delete process.env.ARC_APP_USERS_PATH;
        delete process.env.ARC_APP_USERS_DATABASE;
    });

    describe('with a host app: only people who still have the address (review C7)', () => {
        const a = computeEmailHash('a@x.com');
        const id = (docId: string) => appUserStateId(docId);

        beforeEach(() => {
            process.env.ARC_APP_USERS_DATABASE = '(default)';
            process.env.ARC_APP_USERS_PATH = 'users/{id}';
            m.states.set('app_audience', { key: { source: 'docId' }, emailField: 'email', watchedFields: [] });
        });

        it('leaves out someone who has since changed to another address', async () => {
            m.hostDocs.set('d1', { email: 'b@x.com' });
            m.logs.push({ emailHash: a, appUserId: id('d1'), appDocId: 'd1' });
            expect(await appUserIdsForEmailHash(a, 'a@x.com')).toEqual([]);
        });

        it('finds whoever holds the address now, with or without email logs', async () => {
            m.hostDocs.set('d2', { email: 'A@x.com' });
            m.hostDocs.set('d3', { email: 'a@x.com' });
            const ids = await appUserIdsForEmailHash(a, 'A@x.com');
            expect(ids.sort()).toEqual([id('d2'), id('d3')].sort());
        });

        it('keeps a deleted person and a log that names no document: they cannot be anyone else', async () => {
            m.logs.push({ emailHash: a, appUserId: id('gone'), appDocId: 'gone' }, { emailHash: a, appUserId: 'old-log' });
            expect((await appUserIdsForEmailHash(a)).sort()).toEqual([id('gone'), 'old-log'].sort());
        });

        it('unsubscribes the current owner and not the previous one', async () => {
            m.hostDocs.set('old', { email: 'moved@x.com' });
            m.hostDocs.set('new', { email: 'a@x.com' });
            m.logs.push({ emailHash: a, appUserId: id('old'), appDocId: 'old' });
            await setRecipientConsent(a, 'unsubscribed', 'a@x.com');
            expect(m.states.get(id('new'))?.['consent']).toBe('unsubscribed');
            expect(m.states.has(id('old'))).toBe(false);
        });
    });

    it('an app user unsubscribing updates their record and never creates a contact', async () => {
        m.logs.push({ emailHash: 'e1', appUserId: 'h1' }, { emailHash: 'e1', appUserId: 'h1' });
        await setRecipientConsent('e1', 'unsubscribed', 'a@x.com');
        expect(m.states.get('h1')).toEqual({ consent: 'unsubscribed', consentChangedAt: 'now' });
        expect(m.setContactConsent).not.toHaveBeenCalled();
        expect(m.exitAllEnrollments).toHaveBeenCalledWith('app_h1', 'unsubscribed');
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
        expect(m.exitAllEnrollments).not.toHaveBeenCalled();
    });

    it('shows the contact\'s consent first, then an app user\'s, else nothing', async () => {
        expect(await getRecipientConsent('e1')).toBeNull();
        m.logs.push({ emailHash: 'e1', appUserId: 'h1' });
        expect(await getRecipientConsent('e1')).toBe('subscribed');
        m.contacts.set('e1', { consent: { marketing: 'pending' } });
        expect(await getRecipientConsent('e1')).toBe('pending');
    });
});
