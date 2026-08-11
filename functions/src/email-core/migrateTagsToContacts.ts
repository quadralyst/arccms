import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { computeEmailHash } from './unsubscribeToken.js';
import { ensureTag, addTagsToContact, tagIdFromLabel } from './contactTags.js';

/**
 * Admin callable: lift per-waitlist tags into the global audience layer
 * (audience-unification spec U2, runbook step 5).
 *
 * Reads every `WaitlistUserTags_{waitlistId}` collection, recreates each tag as a
 * global `ContactTags` doc keyed by label-slug — which merges the per-form
 * duplicates ("VIP" in two waitlists becomes one tag) — then copies each
 * member's tag assignments onto their Contact, remapping the old per-form tag
 * ids to the new slugs. Each form's `defaultTagId` is remapped too.
 *
 * Idempotent: tags are ensured (never clobbered) and `addTagsToContact` skips
 * tags a contact already carries, so `usageCount` stays correct across re-runs.
 *
 * Non-destructive: the `WaitlistUserTags_*` collections and member `tags[]` are
 * left in place so the existing per-waitlist UI keeps working. They retire with
 * the member docs in U6/U7.
 *
 * Pass `{ dryRun: true }` to report the plan without writing.
 */
export const migrateTagsToContacts = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const dryRun = request.data?.dryRun === true;

  try {
    const waitlists = await db.collection('Waitlists').get();

    let tagsCreated = 0;
    let tagsMerged = 0;
    let contactsTagged = 0;
    let assignmentsCopied = 0;
    let membersWithoutContact = 0;
    let defaultTagsRemapped = 0;
    const skippedLabels: string[] = [];

    for (const wl of waitlists.docs) {
      const waitlistId = wl.id;

      // Per-waitlist tag collection → global tags. Missing/empty collections are
      // normal (a form may never have defined tags).
      const legacyTags = await db.collection(`WaitlistUserTags_${waitlistId}`).get();
      if (legacyTags.empty) continue;

      // old per-form tag doc id → new global slug
      const idMap = new Map<string, string>();

      for (const t of legacyTags.docs) {
        const data = t.data();
        const label: string = data['label'] || '';
        const slug = tagIdFromLabel(label);
        if (!slug) {
          skippedLabels.push(`${waitlistId}/${t.id}:"${label}"`);
          continue;
        }

        const existed = (await db.collection('ContactTags').doc(slug).get()).exists;
        if (!dryRun) await ensureTag(label, data['color']);
        existed ? tagsMerged++ : tagsCreated++;
        idMap.set(t.id, slug);
      }

      if (!idMap.size) continue;

      // Member assignments → Contacts.tags
      const members = await db.collection('Waitlists').doc(waitlistId).collection('users').get();
      for (const m of members.docs) {
        const data = m.data();
        const email: string | undefined = data['email'];
        const memberTags: string[] = data['tags'] || [];
        if (!email || !memberTags.length) continue;

        const mapped = memberTags.map((id) => idMap.get(id)).filter((x): x is string => !!x);
        if (!mapped.length) continue;

        const emailHash = computeEmailHash(email);
        // Only tag contacts that exist. A member with no contact predates U2's
        // signup sync — backfillPendingContacts creates those, and this can be
        // re-run afterwards to pick them up.
        if (!(await db.collection('Contacts').doc(emailHash).get()).exists) {
          membersWithoutContact++;
          continue;
        }

        if (!dryRun) {
          const added = await addTagsToContact(emailHash, mapped);
          assignmentsCopied += added.length;
          if (added.length) contactsTagged++;
        } else {
          assignmentsCopied += mapped.length;
          contactsTagged++;
        }
      }

      // The form's default tag now has to point at a global tag id.
      const defaultTagId: string | undefined = wl.data()['defaultTagId'];
      if (defaultTagId && idMap.has(defaultTagId)) {
        if (!dryRun) {
          await db.collection('Waitlists').doc(waitlistId).update({ defaultTagId: idMap.get(defaultTagId) });
        }
        defaultTagsRemapped++;
      }
    }

    const result = {
      dryRun,
      forms: waitlists.size,
      tagsCreated,
      tagsMerged,
      contactsTagged,
      assignmentsCopied,
      membersWithoutContact,
      defaultTagsRemapped,
      skippedLabels,
    };
    logger.info('migrateTagsToContacts complete', result);
    return result;
  } catch (err) {
    logger.error('migrateTagsToContacts failed', err);
    throw new HttpsError('internal', 'Tag migration failed.');
  }
});

/** Admin callable: set a contact's tags (Contacts are functions-only writes). */
export const adminSetContactTags = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const emailHash: string = request.data?.emailHash;
  const tagIds: string[] = request.data?.tagIds || [];
  if (!emailHash) throw new HttpsError('invalid-argument', 'emailHash is required.');

  try {
    const { setContactTags } = await import('./contactTags.js');
    await setContactTags(emailHash, tagIds);
    return { ok: true, tagIds };
  } catch (err) {
    logger.error('adminSetContactTags failed', err);
    throw new HttpsError('internal', 'Failed to set contact tags.');
  }
});
