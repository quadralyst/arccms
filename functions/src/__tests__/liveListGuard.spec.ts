/** Contacts are never put on an App users (live) list (email-core/liveListGuard.ts). */
import { describe, it, expect, vi } from 'vitest';

const lists: Record<string, { type: string; name: string }> = {
    newsletter: { type: 'manual', name: 'Newsletter' },
    pros: { type: 'app', name: 'Pro users' },
    trial: { type: 'app', name: 'On trial' },
};
vi.mock('../init', () => ({
    db: {
        collection: vi.fn(() => ({ doc: (id: string) => ({ id }) })),
        getAll: vi.fn(async (...refs: Array<{ id: string }>) =>
            refs.map((r) => ({ id: r.id, exists: r.id in lists, data: () => lists[r.id] }))),
    },
}));
vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string) { super(message); }
    },
}));

import { refuseLiveLists } from '../email-core/liveListGuard.js';

describe('refuseLiveLists', () => {
    it('allows stored lists, unknown ids (created later) and nothing at all', async () => {
        await expect(refuseLiveLists(['newsletter', 'brand-new'])).resolves.toBeUndefined();
        await expect(refuseLiveLists([])).resolves.toBeUndefined();
    });

    it('refuses a live list, naming it', async () => {
        await expect(refuseLiveLists(['newsletter', 'pros'])).rejects.toMatchObject({
            code: 'failed-precondition',
            message: expect.stringContaining('"Pro users" is an App users (live) list'),
        });
        await expect(refuseLiveLists(['pros', 'trial'])).rejects.toMatchObject({
            message: expect.stringContaining('"Pro users", "On trial" are App users (live) lists'),
        });
    });
});
