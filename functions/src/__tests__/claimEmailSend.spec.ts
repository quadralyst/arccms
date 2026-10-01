/**
 * claimEmailSend: the call that queued a `sendNow` email and onEmailLogCreate
 * both try to send it; only the first claim wins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { doc, update } = vi.hoisted(() => ({ doc: { value: undefined as Record<string, unknown> | undefined }, update: vi.fn() }));

vi.mock('../init', () => ({
    db: {
        collection: () => ({ doc: (id: string) => ({ id }) }),
        runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
            get: async () => ({ exists: doc.value !== undefined, data: () => doc.value }),
            update: (_ref: unknown, data: Record<string, unknown>) => {
                update(data);
                doc.value = { ...doc.value, ...data };
            },
        }),
    },
}));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: () => 'now' } }));

import { claimEmailSend } from '../email-core/claimEmailSend.js';

describe('claimEmailSend', () => {
    beforeEach(() => update.mockClear());

    it('lets the first caller claim a pending email, and no one after', async () => {
        doc.value = { status: 'pending', sendNow: true };
        await expect(claimEmailSend('log-1')).resolves.toBe(true);
        expect(update).toHaveBeenCalledWith({ sendClaimedAt: 'now' });
        await expect(claimEmailSend('log-1')).resolves.toBe(false);
    });

    it('refuses an email that is no longer pending, or is gone', async () => {
        doc.value = { status: 'success', sendNow: true };
        await expect(claimEmailSend('log-1')).resolves.toBe(false);
        doc.value = undefined;
        await expect(claimEmailSend('log-1')).resolves.toBe(false);
        expect(update).not.toHaveBeenCalled();
    });
});
