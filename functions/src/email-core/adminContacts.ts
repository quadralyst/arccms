import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import {
  upsertContact,
  setContactConsent,
  addContactToLists,
  removeContactFromLists,
  type MarketingConsent,
} from './contacts.js';

function requireAdmin(request: { auth?: { token?: Record<string, unknown> } }): void {
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
