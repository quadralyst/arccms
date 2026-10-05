/**
 * The contact form's functions (specs/site-sections-spec.md, SS5):
 * submitContactMessage stores what a site's contact form sends, after its spam
 * checks; onContactMessageCreated tells the admins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAdd, mockCollection, mockConsume, mockNotify } = vi.hoisted(() => ({
    mockAdd: vi.fn(),
    mockCollection: vi.fn(),
    mockConsume: vi.fn(),
    mockNotify: vi.fn(),
}));

vi.mock('../init', () => ({ db: { collection: (...a: unknown[]) => mockCollection(...a) } }));
vi.mock('firebase-functions/v2/https', async (importOriginal) => ({
    ...(await importOriginal<typeof import('firebase-functions/v2/https')>()),
    onCall: vi.fn((handler: unknown) => handler),
}));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: vi.fn((_path: unknown, handler: unknown) => handler) }));
vi.mock('../auth/accounts', () => ({
    callerKey: () => 'ip-hash',
    consumeRateLimit: (...a: unknown[]) => mockConsume(...a),
}));
vi.mock('../email-core/adminAlerts', () => ({ notifyAdmins: (...a: unknown[]) => mockNotify(...a) }));

import {
    countLinks, looksAutomated, MESSAGES_PER_HOUR, readContactMessage, submitContactMessage,
} from '../contact/submitContactMessage.js';
import { contactSummary, onContactMessageCreated } from '../contact/onContactMessageCreated.js';

const submit = submitContactMessage as unknown as (request: { data: unknown }) => Promise<unknown>;
const created = onContactMessageCreated as unknown as (event: unknown) => Promise<void>;

const VALID = { name: ' Asha ', email: ' Asha@Example.com ', message: 'Do you deliver to Pune?', page: '/info/contact', lang: 'en', elapsedMs: 9000, website: '' };

beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.mockReturnValue({ add: mockAdd });
    mockConsume.mockResolvedValue(undefined);
});

describe('submitContactMessage', () => {
    it('stores a valid message as new, trimmed, the email in lower case', async () => {
        expect(await submit({ data: VALID })).toEqual({ ok: true });
        expect(mockCollection).toHaveBeenCalledWith('ContactMessages');
        expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Asha', email: 'asha@example.com', message: 'Do you deliver to Pune?', phone: '', subject: '',
            page: '/info/contact', lang: 'en', status: 'new', createdAt: expect.anything(),
        }));
    });

    it('limits each sender address and each email to five an hour', async () => {
        await submit({ data: VALID });
        expect(mockConsume).toHaveBeenCalledWith('contact-ip-ip-hash', MESSAGES_PER_HOUR, 3600000, expect.any(String));
        expect(mockConsume).toHaveBeenCalledWith(expect.stringMatching(/^contact-email-[0-9a-f]{32}$/), MESSAGES_PER_HOUR, 3600000, expect.any(String));
    });

    it('stores nothing past the limit', async () => {
        mockConsume.mockRejectedValueOnce(new Error('Too many'));
        await expect(submit({ data: VALID })).rejects.toThrow('Too many');
        expect(mockAdd).not.toHaveBeenCalled();
    });

    it('tells a bot it worked and stores nothing: the honeypot filled, or sent too soon', async () => {
        expect(await submit({ data: { ...VALID, website: 'http://spam.example' } })).toEqual({ ok: true });
        expect(await submit({ data: { ...VALID, elapsedMs: 800 } })).toEqual({ ok: true });
        expect(mockAdd).not.toHaveBeenCalled();
        expect(mockConsume).not.toHaveBeenCalled();
    });

    it('refuses a missing or bad email, an empty message and anything too long', async () => {
        await expect(submit({ data: { ...VALID, email: 'nope' } })).rejects.toThrow('valid email');
        await expect(submit({ data: { ...VALID, message: '   ' } })).rejects.toThrow('write a message');
        await expect(submit({ data: { ...VALID, message: 'x'.repeat(5001) } })).rejects.toThrow('too long');
        await expect(submit({ data: { ...VALID, name: 'x'.repeat(101) } })).rejects.toThrow('too long');
        await expect(submit({ data: null })).rejects.toThrow('valid email');
        expect(mockAdd).not.toHaveBeenCalled();
    });

    it('keeps a message full of links, as possible spam', () => {
        const links = 'Buy http://a.example http://b.example www.c.example https://d.example';
        expect(countLinks(links)).toBe(4);
        expect(readContactMessage({ ...VALID, message: links }).status).toBe('spam');
        expect(readContactMessage({ ...VALID, message: 'See https://a.example' }).status).toBe('new');
    });

    it('keeps only a path on this site and a language code', () => {
        expect(readContactMessage({ ...VALID, page: 'https://evil.example/x' }).page).toBe('');
        expect(readContactMessage({ ...VALID, page: '//evil.example' }).page).toBe('');
        expect(readContactMessage({ ...VALID, lang: '<script>' }).lang).toBe('');
        expect(readContactMessage({ ...VALID, lang: 'hi' }).lang).toBe('hi');
    });

    it('treats a missing time on the page as a person (an old page script)', () => {
        expect(looksAutomated({})).toBe(false);
        expect(looksAutomated({ elapsedMs: 'soon' })).toBe(false);
    });
});

describe('onContactMessageCreated', () => {
    const event = (data: Record<string, unknown>) => ({ data: { id: 'm1', data: () => data } });

    it('tells the admins, with who wrote and the start of what they asked', async () => {
        await created(event({ name: 'Asha', message: 'Do you deliver to Pune?', status: 'new' }));
        expect(mockConsume).toHaveBeenCalledWith('contact-alerts', 10, 3600000, 'Too many');
        expect(mockNotify).toHaveBeenCalledWith('admin_contact_message', {
            title: 'New message', body: 'Asha: Do you deliver to Pune?', link: '/admin/messages',
        });
    });

    it('raises nothing for possible spam, or past the hourly cap', async () => {
        await created(event({ name: 'Bot', message: 'x', status: 'spam' }));
        mockConsume.mockRejectedValueOnce(new Error('Too many'));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await created(event({ name: 'Asha', message: 'Hi', status: 'new' }));
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('summarises by subject first, then message, cut at 80 characters', () => {
        expect(contactSummary({ email: 'a@b.c', subject: 'Prices', message: 'long' })).toBe('a@b.c: Prices');
        expect(contactSummary({ message: 'y'.repeat(100) })).toBe(`Someone: ${'y'.repeat(80)}...`);
        expect(contactSummary({})).toBe('Someone sent a message.');
    });
});
