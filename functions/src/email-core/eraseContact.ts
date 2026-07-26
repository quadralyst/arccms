import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { removeContactFromLists } from './contacts.js';
import { exitAllEnrollments } from './dripEnrollment.js';

/**
 * Right-to-erasure for a single audience member.
 *
 * ArcCMS stores subscriber addresses, so an operator has to be able to honour a
 * deletion request without Firebase console access. `disabled: true` is not that
 * — it stops mail but retains the address.
 *
 * The address is written in more than one place, and erasing only
 * `Contacts/{emailHash}` would leave it readable in the form's member doc. So
 * this walks every surface that holds the raw address for one person:
 *
 * | surface                     | why it holds the address                |
 * |-----------------------------|-----------------------------------------|
 * | `Contacts/{emailHash}`      | the audience record itself               |
 * | `Waitlists/{id}/users/{id}` | the form member doc, `email` field       |
 * | `WaitlistedUsers`           | pre-cutover registry (U6), `email` field |
 * | `form_otps`                 | in-flight signup verification            |
 * | `Suppression/{emailHash}`   | unsubscribe records carry `email` too    |
 *
 * What it deliberately does NOT do:
 * - **No suppression tombstone.** Erasure means gone; if they want back in
 *   later, a fresh signup should work. The existing `Suppression` doc (if any)
 *   is removed for the same reason — and because it carries the address.
 * - **No `EmailLogs` scrub.** Delivery logs still hold the recipient address
 *   until `purgeEmailLogs` clears them (60-day default). Erasing a contact does
 *   not shorten that window — run the purge if a request requires it.
 *
 * Operator-facing guidance, including how this differs from suppressing and
 * disabling, is in `docs/email-system.md` §9.
 */

export interface EraseContactResult {
  emailHash: string;
  /** False when no contact doc existed — the call is still a successful no-op sweep. */
  existed: boolean;
  /** Lists left, via the membership chokepoint (memberCount + drip exits handled). */
  listsRemoved: string[];
  memberDocsDeleted: number;
  legacyRegistryDocsDeleted: number;
  otpDocsDeleted: number;
  suppressionDeleted: boolean;
}

/**
 * Delete every trace of one contact's address, in dependency order.
 *
 * Ordering is chosen for **retry safety**, not atomicity — this cannot be one
 * transaction, because `removeContactFromLists` is itself transactional and the
 * satellite sweeps are unbounded queries. The Contact doc is deleted LAST, so a
 * mid-way failure leaves a contact that is still visible in the admin UI and
 * still safe to re-run against, rather than an invisible one holding live list
 * memberships and drip enrolments. Every step is idempotent.
 */
export async function eraseContact(
  emailHash: string,
  actorUid: string,
): Promise<EraseContactResult> {
  const ref = db.collection('Contacts').doc(emailHash);
  const snap = await ref.get();
  const email = String(snap.data()?.['email'] || '').trim().toLowerCase();
  const listIds: string[] = (snap.data()?.['listIds'] as string[]) || [];

  const result: EraseContactResult = {
    emailHash,
    existed: snap.exists,
    listsRemoved: [],
    memberDocsDeleted: 0,
    legacyRegistryDocsDeleted: 0,
    otpDocsDeleted: 0,
    suppressionDeleted: false,
  };

  // 1. Leave every list through the sanctioned path, so memberCount stays right
  //    and the contact exits that list's drip campaigns (U7 chokepoint).
  if (listIds.length) {
    result.listsRemoved = await removeContactFromLists(emailHash, listIds);
  }

  // 2. Any enrolment not tied to a list they were still in (e.g. the list was
  //    deleted under them) would otherwise keep sending after erasure.
  await exitAllEnrollments(emailHash, 'erased');

  // 3. Satellite docs holding the raw address. Only reachable by address, so
  //    they are unrecoverable once the Contact doc is gone — hence before it.
  if (email) {
    result.memberDocsDeleted = await deleteFormMemberDocs(email);
    result.legacyRegistryDocsDeleted = await deleteLegacyRegistryDocs(email);
  }
  result.otpDocsDeleted = await deleteOtpDocs(emailHash);
  result.suppressionDeleted = await deleteSuppression(emailHash);

  // 4. The audience record itself.
  if (snap.exists) await ref.delete();

  // 5. Durable proof the request was actioned, holding NO address. `emailHash`
  //    is pseudonymous — re-hash a future complaint's address to match it —
  //    which is the whole reason the log can exist at all.
  //
  //    Written last so it only ever claims a completed erasure. If this single
  //    tiny write is the thing that fails, the counts go to the function log and
  //    the call throws, so the operator knows to re-run (a re-run is a safe
  //    no-op sweep that rewrites the log).
  await writeErasureLog(result, actorUid);

  return result;
}

/**
 * Delete the form member docs carrying this address.
 *
 * Uses the existing `users` COLLECTION_GROUP index on `email` (see
 * `firestore.indexes.json` fieldOverrides), which is why this is a single query
 * rather than a per-form loop.
 *
 * **The parent check is load-bearing.** `users` is also a TOP-LEVEL collection
 * holding real user accounts, and a collection-group query matches those too —
 * deleting one would destroy an account. A member doc's grandparent is the
 * `Waitlists` collection; a top-level `users` doc has `parent.parent === null`.
 */
async function deleteFormMemberDocs(email: string): Promise<number> {
  const snap = await db.collectionGroup('users').where('email', '==', email).get();
  const memberDocs = snap.docs.filter((d) => d.ref.parent.parent?.parent.id === 'Waitlists');
  await Promise.all(memberDocs.map((d) => d.ref.delete()));
  return memberDocs.length;
}

/**
 * Delete pre-cutover registry docs (U6). The collection is frozen, not gone: an
 * upgraded deployment can still hold historical signups whose `email` field is a
 * readable address, so erasure has to reach them.
 */
async function deleteLegacyRegistryDocs(email: string): Promise<number> {
  const snap = await db.collection('WaitlistedUsers').where('email', '==', email).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  return snap.size;
}

/** Drop any in-flight signup verification (`form_otps` stores the address). */
async function deleteOtpDocs(emailHash: string): Promise<number> {
  const snap = await db.collection('form_otps').where('emailHash', '==', emailHash).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  return snap.size;
}

/** Remove the unsubscribe record — it carries `email`, and erasure is not suppression. */
async function deleteSuppression(emailHash: string): Promise<boolean> {
  const ref = db.collection('Suppression').doc(emailHash);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

/** Hash-keyed erasure receipt. Never carries the address. */
async function writeErasureLog(result: EraseContactResult, actorUid: string): Promise<void> {
  await db.collection('ErasureLog').doc(result.emailHash).set({
    emailHash: result.emailHash,
    erasedAt: Timestamp.now(),
    erasedByUid: actorUid,
    removed: {
      contact: result.existed,
      lists: result.listsRemoved.length,
      memberDocs: result.memberDocsDeleted,
      legacyRegistryDocs: result.legacyRegistryDocsDeleted,
      otpDocs: result.otpDocsDeleted,
      suppression: result.suppressionDeleted,
    },
  });
  logger.info(`eraseContact: erased ${result.emailHash}`, result);
}
