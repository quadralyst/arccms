/**
 * npm run forms:remove-referrals: delete the referral records older installs still
 * hold (specs/form-gamification-spec.md, docs/app/scripts-and-data.html).
 *
 * Signup forms no longer have referrals. Each old record names the person who was
 * referred (`referredEmail`), and the trigger that removed it when that person was
 * deleted is gone, so the records are deleted once, here.
 *
 *   npm run forms:remove-referrals                    count them on the dev project
 *   npm run forms:remove-referrals -- --apply         delete them
 *   npm run forms:remove-referrals -- --prod --apply  the "production" alias
 *
 * Records live under a form's member (Waitlists/{form}/users/{member}/referrals) or,
 * on the oldest installs, under the retired registry (WaitlistedUsers/{id}/referrals).
 * Nothing else named `referrals` is touched.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runAdminScript } from './arc-admin-script.mjs';

/** A signup form's referral record, by its path. */
export const REFERRAL_PATH = /^(Waitlists\/[^/]+\/users\/[^/]+|WaitlistedUsers\/[^/]+)\/referrals\/[^/]+$/;

const BATCH = 400;

/**
 * Count, or with `apply` delete, every signup form referral record.
 * Returns how many there were and how many were deleted.
 */
export async function removeReferrals(db, { apply = false, log = console.log } = {}) {
    const snap = await db.collectionGroup('referrals').get();
    const refs = snap.docs.map((d) => d.ref).filter((ref) => REFERRAL_PATH.test(ref.path));
    log(`  Referral records: ${refs.length}`);
    if (!apply) {
        if (refs.length) log('  Nothing deleted. Run again with --apply to delete them.');
        return { found: refs.length, deleted: 0 };
    }
    let deleted = 0;
    for (let i = 0; i < refs.length; i += BATCH) {
        const batch = db.batch();
        for (const ref of refs.slice(i, i + BATCH)) batch.delete(ref);
        await batch.commit();
        deleted += Math.min(BATCH, refs.length - i);
        log(`  Deleted ${deleted} of ${refs.length}`);
    }
    return { found: refs.length, deleted };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runAdminScript(async ({ db, args }) => {
        const unknown = args.filter((arg) => arg !== '--apply');
        if (unknown.length) throw new Error(`Unknown option ${unknown.join(' ')}. Use --apply to delete.`);
        await removeReferrals(db, { apply: args.includes('--apply') });
    });
}
