/**
 * npm run forms:remove-referrals (scripts/forms-remove-referrals.mjs,
 * specs/form-gamification-spec.md): the one-off deletion of signup form referral
 * records, which name other people's email addresses.
 */
import { describe, expect, it, vi } from 'vitest';
import { REFERRAL_PATH, removeReferrals } from '../forms-remove-referrals.mjs';

function fakeDb(paths: string[]) {
    const deleted: string[] = [];
    const commits: number[] = [];
    const db = {
        collectionGroup: vi.fn((name: string) => ({
            get: async () => ({ docs: name === 'referrals' ? paths.map((path) => ({ ref: { path } })) : [] }),
        })),
        batch: () => {
            const pending: string[] = [];
            return {
                delete: (ref: { path: string }) => { pending.push(ref.path); },
                commit: async () => { deleted.push(...pending); commits.push(pending.length); },
            };
        },
    };
    return { db, deleted, commits };
}

const FORM = 'Waitlists/launch/users/m1/referrals/r1';
const LEGACY = 'WaitlistedUsers/w1/referrals/r2';
const OTHER = 'Shops/s1/referrals/r3';

describe('forms:remove-referrals', () => {
    it('matches signup form referral records only', () => {
        expect(REFERRAL_PATH.test(FORM)).toBe(true);
        expect(REFERRAL_PATH.test(LEGACY)).toBe(true);
        expect(REFERRAL_PATH.test(OTHER)).toBe(false);
        expect(REFERRAL_PATH.test('Waitlists/launch/referrals/r4')).toBe(false);
    });

    it('only counts unless asked to delete', async () => {
        const { db, deleted } = fakeDb([FORM, LEGACY, OTHER]);
        const log = vi.fn();

        expect(await removeReferrals(db, { log })).toEqual({ found: 2, deleted: 0 });
        expect(deleted).toEqual([]);
        expect(log).toHaveBeenCalledWith('  Nothing deleted. Run again with --apply to delete them.');
    });

    it('deletes them with --apply, in batches, and leaves other collections alone', async () => {
        const many = Array.from({ length: 401 }, (_, i) => `Waitlists/f/users/m${i}/referrals/r`);
        const { db, deleted, commits } = fakeDb([...many, OTHER]);

        expect(await removeReferrals(db, { apply: true, log: () => {} })).toEqual({ found: 401, deleted: 401 });
        expect(commits).toEqual([400, 1]);
        expect(deleted).not.toContain(OTHER);
    });
});
