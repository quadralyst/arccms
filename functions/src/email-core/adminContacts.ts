import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import {
  upsertContact,
  setContactConsent,
  setContactDisabled,
  addContactToLists,
  removeContactFromLists,
  type MarketingConsent,
} from './contacts.js';
import { eraseContact } from './eraseContact.js';

function requireAdmin(request: { auth?: { uid?: string; token?: Record<string, unknown> } }): void {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }
}

/** Admin: manually add/update a contact (Contacts is functions-only). */
export const adminAddContact = onCall(async (request) => {
  requireAdmin(request);
  const email = String(request.data?.email || '').trim().toLowerCase();
  if (!email.includes('@')) throw new HttpsError('invalid-argument', 'A valid email is required.');

  const listIds = Array.isArray(request.data?.listIds) ? (request.data.listIds as string[]) : [];
  const consentAffirmed = request.data?.consentAffirmed === true;

  const { emailHash, created } = await upsertContact({
    email,
    name: request.data?.name,
    source: 'manual',
    addLists: listIds,
    consent: consentAffirmed ? 'subscribed' : 'pending',
  });
  return { emailHash, created };
});

/** Admin: set a contact's marketing consent; syncs the Suppression list. */
export const adminSetContactConsent = onCall(async (request) => {
  requireAdmin(request);
  const emailHash = String(request.data?.emailHash || '');
  const marketing = String(request.data?.marketing || '') as MarketingConsent;
  if (!emailHash || !['subscribed', 'unsubscribed', 'pending'].includes(marketing)) {
    throw new HttpsError('invalid-argument', 'emailHash and a valid marketing consent are required.');
  }

  await setContactConsent(emailHash, marketing);

  const suppRef = db.collection('Suppression').doc(emailHash);
  if (marketing === 'unsubscribed') {
    const snap = await db.collection('Contacts').doc(emailHash).get();
    await suppRef.set(
      { email: snap.data()?.['email'] || '', emailHash, reason: 'manual', at: Timestamp.now() },
      { merge: true },
    );
  } else if (marketing === 'subscribed') {
    // Lift only self-service/manual suppression — never a hard bounce/complaint.
    const supp = await suppRef.get();
    const reason = supp.data()?.['reason'];
    if (supp.exists && (reason === 'unsubscribe' || reason === 'manual')) {
      await suppRef.delete();
    }
  }
  return { ok: true };
});

/**
 * Admin: switch a contact's email off or back on (U-D12).
 *
 * The escape hatch for form-fed lists, whose membership is read-only in the List
 * hub — you cannot remove someone from a `waitlist-{id}` list without desyncing
 * it from the form's member docs, so you disable them instead. Blocks every
 * category in `queueEmail`, and is reversible.
 */
export const adminSetContactDisabled = onCall(async (request) => {
  requireAdmin(request);
  const emailHash = String(request.data?.emailHash || '');
  if (!emailHash) throw new HttpsError('invalid-argument', 'emailHash is required.');
  const disabled = request.data?.disabled === true;

  await setContactDisabled(emailHash, disabled);
  return { ok: true, disabled };
});

/**
 * Admin: erase a contact — the right-to-erasure path (U-D12 companion).
 *
 * Distinct from `adminSetContactDisabled`, which retains the address, and from
 * `adminSetContactConsent('unsubscribed')`, which deliberately *records* it in
 * `Suppression`. This deletes the address everywhere one person's copy of it
 * lives, including the form member doc, and leaves a hash-only receipt in
 * `ErasureLog`.
 *
 * Irreversible, so it demands `confirm: true` rather than trusting a UI dialog —
 * the callable is reachable by any admin token, not just through the drawer.
 */
export const adminDeleteContact = onCall(async (request) => {
  requireAdmin(request);
  const emailHash = String(request.data?.emailHash || '');
  if (!emailHash) throw new HttpsError('invalid-argument', 'emailHash is required.');
  if (request.data?.confirm !== true) {
    throw new HttpsError('failed-precondition', 'Erasure is irreversible; pass confirm: true.');
  }

  return eraseContact(emailHash, request.auth?.uid || 'unknown');
});

/** Admin: add/remove a contact from lists. */
export const adminUpdateContactLists = onCall(async (request) => {
  requireAdmin(request);
  const emailHash = String(request.data?.emailHash || '');
  if (!emailHash) throw new HttpsError('invalid-argument', 'emailHash is required.');
  const add = Array.isArray(request.data?.add) ? (request.data.add as string[]) : [];
  const remove = Array.isArray(request.data?.remove) ? (request.data.remove as string[]) : [];

  const added = add.length ? await addContactToLists(emailHash, add) : [];
  const removed = remove.length ? await removeContactFromLists(emailHash, remove) : [];
  return { added, removed };
});
