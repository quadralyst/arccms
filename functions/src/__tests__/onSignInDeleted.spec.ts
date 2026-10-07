/**
 * A sign-in deleted outside Arc CMS (functions/src/users/onSignInDeleted.ts,
 * docs/app/account-contract.html): the record stays and `user.signInDeleted` says so,
 * once. Arc CMS's own deletions delete the record first, so they never set it off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const fb = vi.hoisted(() => {
    const state = { records: [] as Array<{ id: string; data: Record<string, unknown> }> };
    const recordRef = (id: string) => ({
        id,
        delete: vi.fn(async () => { state.records = state.records.filter((r) => r.id !== id); }),
    });
    const db = {
        collection: vi.fn(() => ({
            where: vi.fn((_field: string, _op: string, uid: string) => ({
                limit: () => ({
                    get: async () => {
                        const found = state.records.filter((r) => r.data['uid'] === uid);
                        return { empty: !found.length, docs: found.map((r) => ({ exists: true, ref: recordRef(r.id), data: () => r.data })) };
                    },
                }),
            })),
        })),
    };
    const emitted = new Map<string, { type: string; payload: unknown }>();
    // Like the real emitAppEvent: an event with an id is written once, whatever the retries.
    const emitAppEvent = vi.fn(async (type: string, payload: unknown, options: { id?: string } = {}) => {
        const id = options.id ?? `auto-${emitted.size + 1}`;
        if (!emitted.has(id)) emitted.set(id, { type, payload });
        return id;
    });
    const v1 = { region: vi.fn(), onDelete: vi.fn() };
    return { state, db, emitted, emitAppEvent, v1 };
});

vi.mock('../init.js', () => ({ db: fb.db, owner: {} }));
vi.mock('../email-core/appEvents.js', () => ({ emitAppEvent: fb.emitAppEvent }));
vi.mock('firebase-functions/v1', () => ({
    region: (...regions: unknown[]) => {
        fb.v1.region(...regions);
        return { auth: { user: () => ({ onDelete: (handler: Function) => { fb.v1.onDelete(handler); return handler; } }) } };
    },
}));

const { handleSignInDeleted, onSignInDeleted, SIGN_IN_DELETED } = await import('../users/onSignInDeleted.js');
const { deleteAppAccount } = await import('../app-kit/accounts.js');
const { arcFunctionsRegionParam } = await import('../arc-config.js');

/** Firebase deleting a sign-in: the trigger as deployed, with Firebase's event id. */
const signInDeleted = (uid: string, eventId = `evt-${uid}`) =>
    (onSignInDeleted as unknown as (user: { uid: string }, context: { eventId: string }) => Promise<unknown>)({ uid }, { eventId });

const appAccount = (id: string, uid: string, extra: Record<string, unknown> = {}) =>
    fb.state.records.push({ id, data: { id, uid, name: 'Staff', by: 'app', selfService: false, ...extra } });

beforeEach(() => {
    fb.state.records = [];
    fb.emitted.clear();
    fb.emitAppEvent.mockClear();
});

describe('onSignInDeleted', () => {
    it('is an Auth deletion trigger in the install\'s functions region', () => {
        expect(fb.v1.region).toHaveBeenCalledWith(arcFunctionsRegionParam);
        expect(fb.v1.onDelete).toHaveBeenCalledTimes(1);
    });

    it('notices a locked app account\'s sign-in deleted by the browser, and keeps the record', async () => {
        appAccount('rec-1', 'staff-1');
        await signInDeleted('staff-1');
        expect([...fb.emitted.values()]).toEqual([
            { type: SIGN_IN_DELETED, payload: { userId: 'staff-1', data: { userDocId: 'rec-1', locked: true } } },
        ]);
        expect(SIGN_IN_DELETED).toBe('user.signInDeleted');
        expect(fb.state.records.map((r) => r.id)).toEqual(['rec-1']);
    });

    it('says so for any record left behind, with locked false when the person may change it', async () => {
        appAccount('rec-2', 'staff-2', { selfService: true });
        fb.state.records.push({ id: 'rec-3', data: { id: 'rec-3', uid: 'member-3', by: 'email' } });
        await signInDeleted('staff-2');
        await signInDeleted('member-3');
        expect([...fb.emitted.values()].map((e) => (e.payload as { data: unknown }).data)).toEqual([
            { userDocId: 'rec-2', locked: false },
            { userDocId: 'rec-3', locked: false },
        ]);
    });

    it('emits one event when Firebase delivers the same deletion twice', async () => {
        appAccount('rec-4', 'staff-4');
        await signInDeleted('staff-4', 'evt-same');
        await signInDeleted('staff-4', 'evt-same');
        expect(fb.emitAppEvent).toHaveBeenCalledTimes(2);
        expect(fb.emitted.size).toBe(1);
        expect(fb.emitAppEvent.mock.calls[0][2]).toEqual({ id: 'signInDeleted-evt-same' });
    });

    it('does nothing when no record points at the sign-in, or there is no uid', async () => {
        expect(await handleSignInDeleted('nobody', 'evt-1')).toBeNull();
        expect(await handleSignInDeleted('', 'evt-2')).toBeNull();
        expect(fb.emitAppEvent).not.toHaveBeenCalled();
    });
});

describe('Arc CMS\'s own deletions never set it off', () => {
    it('deleteAppAccount: the record goes first, so the sign-in deletion that follows emits nothing', async () => {
        appAccount('rec-5', 'staff-5');
        await deleteAppAccount('staff-5');
        // onUserDeleted, started by the record delete, then deletes the sign-in:
        await signInDeleted('staff-5');
        expect(fb.emitAppEvent).not.toHaveBeenCalled();
    });

    // deleteMyAccount and the admin's Users, Delete also delete the record, and only
    // onUserDeleted deletes the sign-in, after it. The other owner.deleteUser calls undo
    // a sign-up before its record exists. A new caller must keep to that order.
    it('deletes a sign-in only in the known places, each after its record is gone or before it exists', () => {
        const SRC = join(__dirname, '..');
        const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) return name === '__tests__' || name === 'custom' ? [] : files(path);
            return path.endsWith('.ts') ? [path] : [];
        });
        const callers = files(SRC)
            .filter((file) => /owner\.deleteUser\(/.test(readFileSync(file, 'utf8')))
            .map((file) => relative(SRC, file))
            .sort();
        expect(callers).toEqual([
            'app-kit/accounts.ts', // createAppAccount: the record could not be written
            'auth/phoneAuth.ts', // completePhoneSignup: the record could not be written
            'users/adminCreateUser.ts', // adminCreateUser: the record could not be written
            'users/onUserDelete.ts', // after the record was deleted
        ]);
        const own = readFileSync(join(SRC, 'users/accountCallables.ts'), 'utf8');
        expect(own).not.toMatch(/deleteUser\(/);
    });
});
