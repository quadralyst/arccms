/**
 * Feedback: the trigger adds the sender from their record and tells the admins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifyAdmins = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner: {} };
});
vi.mock('../email-core/adminAlerts', () => ({ notifyAdmins }));
vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: vi.fn((_path: string, handler: unknown) => handler),
}));

import { db } from '../init.js';
import { feedbackSummary, onFeedbackCreated } from '../feedback/onFeedbackCreated.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
type Handler = (event: unknown) => Promise<void>;
const run = (id: string) =>
    (onFeedbackCreated as unknown as Handler)({ data: { data: () => mem.read('Feedback', id), ref: db.collection('Feedback').doc(id) } });

beforeEach(() => {
    mem.store.clear();
    notifyAdmins.mockClear();
});

describe('feedbackSummary', () => {
    it('starts with the message, shortened', () => {
        expect(feedbackSummary('Asha', '  The   lesson froze ', false)).toBe('Asha: The lesson froze');
        expect(feedbackSummary('Asha', 'x'.repeat(100), false)).toBe(`Asha: ${'x'.repeat(80)}...`);
    });

    it('says when there is only a voice note', () => {
        expect(feedbackSummary('Asha', '', true)).toBe('Asha sent a voice note.');
        expect(feedbackSummary('Asha', undefined, false)).toBe('Asha sent feedback.');
    });
});

describe('onFeedbackCreated', () => {
    it('adds the sender from their record and alerts the admins', async () => {
        mem.seed('users', 'rec-1', { uid: 'u1', name: 'Asha Rao', email: 'asha@example.com', phone: '+919876543210' });
        mem.seed('Feedback', 'f1', { userDocId: 'rec-1', message: 'The lesson froze', status: 'new' });
        await run('f1');
        expect(mem.read('Feedback', 'f1')).toMatchObject({
            message: 'The lesson froze',
            sender: { name: 'Asha Rao', email: 'asha@example.com', phone: '+919876543210' },
        });
        expect(notifyAdmins).toHaveBeenCalledWith('admin_new_feedback', {
            title: 'New feedback', body: 'Asha Rao: The lesson froze', link: '/admin/feedback',
        });
    });

    it('still alerts when the record is gone', async () => {
        mem.seed('Feedback', 'f2', { userDocId: 'rec-x', message: '', voicePath: 'users/rec-x/feedback/f2/voice.mp4' });
        await run('f2');
        expect(mem.read('Feedback', 'f2')!['sender']).toEqual({ name: '', email: '', phone: '' });
        expect(notifyAdmins).toHaveBeenCalledWith('admin_new_feedback', expect.objectContaining({ body: 'Someone sent a voice note.' }));
    });
});
