/**
 * The first user record marks the install as having members (`_system/has_members`),
 * which closes the public list of `email_lookup` (firestore.rules) even on an app
 * whose members sign up without the setup wizard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner: {} };
});
vi.mock('../email-core/appEvents.js', () => ({ emitAppEvent: vi.fn(async () => 'event-1') }));
vi.mock('../email-core/adminAlerts.js', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: vi.fn((_path: string, handler: unknown) => handler) }));

import { db } from '../init.js';
import { HAS_MEMBERS_DOC, onUserCreated } from '../users/onUserCreate.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
const handler = onUserCreated as unknown as (event: unknown) => Promise<void>;
const created = (data: Record<string, unknown>) => ({ data: { data: () => data } });

describe('onUserCreated marks that the install has members', () => {
    beforeEach(() => mem.store.clear());

    it('writes the marker for the first member, signed up by email', async () => {
        await handler(created({ uid: 'u1', email: 'first@site.test' }));
        expect(mem.read(HAS_MEMBERS_DOC.collection, HAS_MEMBERS_DOC.doc)).toBeDefined();
    });

    it('writes it for a member with no email, such as a phone sign-up', async () => {
        await handler(created({ uid: 'u2', phone: '+910000000000' }));
        expect(mem.read(HAS_MEMBERS_DOC.collection, HAS_MEMBERS_DOC.doc)).toBeDefined();
    });

    it('keeps the first marker when later members sign up', async () => {
        mem.seed(HAS_MEMBERS_DOC.collection, HAS_MEMBERS_DOC.doc, { since: 'first' });
        await expect(handler(created({ uid: 'u3', email: 'later@site.test' }))).resolves.toBeUndefined();
        expect(mem.read(HAS_MEMBERS_DOC.collection, HAS_MEMBERS_DOC.doc)).toEqual({ since: 'first' });
    });
});
