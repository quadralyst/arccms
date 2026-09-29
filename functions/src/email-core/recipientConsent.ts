/**
 * Marketing consent for whoever an email hash belongs to: a contact, an app
 * user (docs/coexistence-spec.md 5b, CO6.5a), or both.
 *
 * App users are not contacts, and unsubscribing must not make them one, so a
 * change of consent is written to each app user behind the address and to the
 * contact only when one exists or no app user is involved. `Suppression` stays
 * the durable gate either way.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { db, firestoreFor } from '../init.js';
import type { MarketingConsent } from './contacts.js';
import { setContactConsent } from './contacts.js';
import { APP_AUDIENCE_STATE, appUserStateId, stateFrom } from '../app-audience/state.js';
import { appContactId, exitAllEnrollments } from './dripEnrollment.js';
import { computeEmailHash } from './unsubscribeToken.js';
import { appUsersLocation } from '../app-audience/config.js';
import { readAppAudienceSettings } from '../app-audience/settings.js';
import { resolveAppUser } from '../app-audience/fields.js';

/** How many of an address's email logs are read for the app users it was mailed as. */
const LOG_SCAN = 100;
/** How many host documents with the address are read (normally one). */
const HOST_SCAN = 20;

/**
 * The app users behind an address now (review C7): whoever the host app holds
 * with that address, and whoever it was mailed as (from its email logs) who
 * still has it.
 *
 * - The host app is searched by its email field, so the current owner is found
 *   however many emails the address has had (the logs alone are capped).
 * - A person from the logs counts only if their host document still has the
 *   address. Someone who changed their email is not unsubscribed by a link sent
 *   to the next owner of their old address, nor that owner by theirs.
 * - A deleted host document still counts (it is their own record, kept so a
 *   returning person is not mailed against an unsubscribe), and so does a log
 *   written before logs named the document (it cannot be checked).
 * An id is the person's current App audience id, which follows a key change.
 */
export async function appUserIdsForEmailHash(emailHash: string, email?: string): Promise<string[]> {
  const logs = await db.collection('EmailLogs').where('emailHash', '==', emailHash).limit(LOG_SCAN).get();
  const fromLogs = new Map<string, string | undefined>();
  for (const doc of logs.docs) {
    const id = doc.data()['appUserId'];
    const docId = doc.data()['appDocId'];
    if (typeof id === 'string' && id) fromLogs.set(id, typeof docId === 'string' && docId ? docId : fromLogs.get(id));
  }

  const location = appUsersLocation();
  if (!location.configured) return [...fromLogs.keys()];
  const settings = await readAppAudienceSettings();
  const host = firestoreFor(location.database).collection(location.collection);
  const ids = new Set<string>();
  const holdsAddress = (docId: string, data: Record<string, unknown>): string | null => {
    const person = resolveAppUser(docId, data, settings);
    return person.key && person.email && computeEmailHash(person.email) === emailHash ? appUserStateId(person.key) : null;
  };

  if (email && settings.emailField) {
    for (const value of new Set([email.trim(), email.trim().toLowerCase()])) {
      const snap = await host.where(settings.emailField, '==', value).limit(HOST_SCAN).get();
      for (const doc of snap.docs) {
        const id = holdsAddress(doc.id, doc.data());
        if (id) ids.add(id);
      }
    }
  }

  for (const [id, docId] of fromLogs) {
    if (!docId) { ids.add(id); continue; }
    const snap = await host.doc(docId).get();
    if (!snap.exists) { ids.add(id); continue; }
    const current = holdsAddress(docId, snap.data() ?? {});
    if (current) ids.add(current);
  }
  return [...ids];
}

/** Records a consent change for everyone behind this email hash. */
export async function setRecipientConsent(emailHash: string, consent: MarketingConsent, email?: string): Promise<void> {
  const [appUserIds, contact] = await Promise.all([
    appUserIdsForEmailHash(emailHash, email),
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
export async function getRecipientConsent(emailHash: string, email?: string): Promise<MarketingConsent | null> {
  const contact = await db.collection('Contacts').doc(emailHash).get();
  const contactConsent = contact.exists ? (contact.data()?.['consent']?.['marketing'] as MarketingConsent | undefined) : undefined;
  if (contactConsent) return contactConsent;
  const [first] = await appUserIdsForEmailHash(emailHash, email);
  if (!first) return null;
  const state = await db.collection(APP_AUDIENCE_STATE).doc(first).get();
  return stateFrom(state.exists ? state.data() : undefined).consent;
}
