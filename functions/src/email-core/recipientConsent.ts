/**
 * Marketing consent for whoever an email hash belongs to: a contact, an app
 * user (docs/coexistence-spec.md 5b, CO6.5a), or both.
 *
 * App users are not contacts, and unsubscribing must not make them one, so a
 * change of consent is written to each app user the address was mailed as
 * (`EmailLogs.appUserId`) and to the contact only when one exists or no app
 * user is involved. `Suppression` stays the durable gate either way.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { MarketingConsent } from './contacts.js';
import { setContactConsent } from './contacts.js';
import { APP_AUDIENCE_STATE, stateFrom } from '../app-audience/state.js';
import { appContactId, exitAllEnrollments } from './dripEnrollment.js';

/** App users an address has been mailed as, from its email log. */
export async function appUserIdsForEmailHash(emailHash: string): Promise<string[]> {
  const snap = await db.collection('EmailLogs').where('emailHash', '==', emailHash).limit(100).get();
  const ids = new Set<string>();
  for (const doc of snap.docs) {
    const id = doc.data()['appUserId'];
    if (typeof id === 'string' && id) ids.add(id);
  }
  return [...ids];
}

/** Records a consent change for everyone behind this email hash. */
export async function setRecipientConsent(emailHash: string, consent: MarketingConsent, email?: string): Promise<void> {
  const [appUserIds, contact] = await Promise.all([
    appUserIdsForEmailHash(emailHash),
    db.collection('Contacts').doc(emailHash).get(),
  ]);
  if (contact.exists || !appUserIds.length) await setContactConsent(emailHash, consent, email);
  const now = Timestamp.now();
  await Promise.all(appUserIds.map((id) =>
    db.collection(APP_AUDIENCE_STATE).doc(id).set({ consent, consentChangedAt: now }, { merge: true })));
  // An unsubscribe also ends the person's sequences on live lists (CO6.5c).
  if (consent === 'unsubscribed') {
    await Promise.all(appUserIds.map((id) => exitAllEnrollments(appContactId(id), 'unsubscribed')));
  }
}

/** The consent to show for this email hash: the contact's, else an app user's, else null. */
export async function getRecipientConsent(emailHash: string): Promise<MarketingConsent | null> {
  const contact = await db.collection('Contacts').doc(emailHash).get();
  const contactConsent = contact.exists ? (contact.data()?.['consent']?.['marketing'] as MarketingConsent | undefined) : undefined;
  if (contactConsent) return contactConsent;
  const [first] = await appUserIdsForEmailHash(emailHash);
  if (!first) return null;
  const state = await db.collection(APP_AUDIENCE_STATE).doc(first).get();
  return stateFrom(state.exists ? state.data() : undefined).consent;
}
