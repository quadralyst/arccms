import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { computeEmailHash } from './unsubscribeToken.js';

/**
 * Unified audience layer (spec §3.5–3.6, D5).
 *
 * `Contacts/{emailHash}` is the single source of truth for who can be emailed
 * and their marketing consent. List membership lives ON the contact
 * (`listIds`) — a single write moves someone — and every membership change goes
 * through {@link addContactToLists} / {@link removeContactFromLists}, which also
 * maintain `Lists.memberCount`.
 */

export type ContactSource = 'waitlist' | 'signup' | 'customer' | 'import' | 'manual';
export type MarketingConsent = 'subscribed' | 'unsubscribed' | 'pending';

/** Seeded, auto-maintained system lists (not deletable). */
export const SYSTEM_LISTS = {
  ALL_USERS: 'all-users',
  ALL_CUSTOMERS: 'all-customers',
} as const;

/** Deterministic list id mirroring a waitlist's verified members. */
export function waitlistListId(waitlistId: string): string {
  return `waitlist-${waitlistId}`;
}

export interface EnsureListParams {
  name: string;
  description?: string;
  type?: 'manual' | 'system';
}

/** Create a list doc if it doesn't exist yet (never resets an existing memberCount). */
export async function ensureList(listId: string, params: EnsureListParams): Promise<void> {
  const ref = db.collection('Lists').doc(listId);
  const snap = await ref.get();
  if (snap.exists) return;
  const now = Timestamp.now();
  await ref.set({
    id: listId,
    name: params.name,
    description: params.description || '',
    type: params.type || 'system',
    memberCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

/** Seed the always-present system lists. */
export async function ensureSystemLists(): Promise<void> {
  await ensureList(SYSTEM_LISTS.ALL_USERS, { name: 'All Users', type: 'system' });
  await ensureList(SYSTEM_LISTS.ALL_CUSTOMERS, { name: 'All Customers', type: 'system' });
}

export interface UpsertContactParams {
  email: string;
  name?: string;
  firstName?: string;
  userId?: string;
  source: ContactSource;
  /** Lists to join (membership goes through addContactToLists). */
  addLists?: string[];
  /** Initial marketing consent when the contact is first created. Default 'subscribed'. */
  consent?: MarketingConsent;
}

export interface UpsertContactResult {
  emailHash: string;
  created: boolean;
}

/**
 * Create or update a `Contacts/{emailHash}` doc. Merges identity fields, unions
 * the source, and (on first creation) sets default marketing consent. List
 * membership is applied via addContactToLists so memberCount stays correct.
 */
export async function upsertContact(params: UpsertContactParams): Promise<UpsertContactResult> {
  const email = (params.email || '').trim().toLowerCase();
  const emailHash = computeEmailHash(email);
  const ref = db.collection('Contacts').doc(emailHash);
  const snap = await ref.get();
  const now = Timestamp.now();

  const data: Record<string, unknown> = {
    email,
    emailHash,
    sources: FieldValue.arrayUnion(params.source),
    updatedAt: now,
  };
  if (params.name) data['name'] = params.name;
  if (params.firstName) data['firstName'] = params.firstName;
  if (params.userId) data['userId'] = params.userId;

  if (!snap.exists) {
    data['createdAt'] = now;
    data['listIds'] = [];
    data['consent'] = { marketing: params.consent || 'subscribed', marketingChangedAt: now };
  }

  await ref.set(data, { merge: true });

  if (params.addLists?.length) {
    await addContactToLists(emailHash, params.addLists);
  }

  return { emailHash, created: !snap.exists };
}

/**
 * Add a contact to one or more lists (the single sanctioned join path).
 * Only lists the contact isn't already in increment `memberCount`, so repeated
 * calls are idempotent.
 */
export async function addContactToLists(emailHash: string, listIds: string[]): Promise<string[]> {
  const wanted = [...new Set(listIds.filter(Boolean))];
  if (!wanted.length) return [];
  const ref = db.collection('Contacts').doc(emailHash);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return [];
    const current: string[] = (snap.data()?.['listIds'] as string[]) || [];
    const toAdd = wanted.filter((id) => !current.includes(id));
    if (!toAdd.length) return [];

    txn.update(ref, { listIds: FieldValue.arrayUnion(...toAdd), updatedAt: Timestamp.now() });
    for (const listId of toAdd) {
      txn.set(
        db.collection('Lists').doc(listId),
        { memberCount: FieldValue.increment(1), updatedAt: Timestamp.now() },
        { merge: true },
      );
    }
    return toAdd;
  });
}

/**
 * Remove a contact from one or more lists (the single sanctioned leave path).
 * Only lists the contact is actually in decrement `memberCount`.
 */
export async function removeContactFromLists(emailHash: string, listIds: string[]): Promise<string[]> {
  const wanted = [...new Set(listIds.filter(Boolean))];
  if (!wanted.length) return [];
  const ref = db.collection('Contacts').doc(emailHash);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return [];
    const current: string[] = (snap.data()?.['listIds'] as string[]) || [];
    const toRemove = wanted.filter((id) => current.includes(id));
    if (!toRemove.length) return [];

    txn.update(ref, { listIds: FieldValue.arrayRemove(...toRemove), updatedAt: Timestamp.now() });
    for (const listId of toRemove) {
      txn.set(
        db.collection('Lists').doc(listId),
        { memberCount: FieldValue.increment(-1), updatedAt: Timestamp.now() },
        { merge: true },
      );
    }
    return toRemove;
  });
}

/** Set a contact's marketing consent (upserts a minimal contact if absent). */
export async function setContactConsent(
  emailHash: string,
  marketing: MarketingConsent,
  email?: string,
): Promise<void> {
  const now = Timestamp.now();
  const data: Record<string, unknown> = {
    emailHash,
    consent: { marketing, marketingChangedAt: now },
    updatedAt: now,
  };
  if (email) data['email'] = email.trim().toLowerCase();
  await db.collection('Contacts').doc(emailHash).set(data, { merge: true });
}

/**
 * Read a contact's marketing consent. Returns null when no contact exists yet
 * (callers fall back to legacy signals such as waitlist `isSubscribed`).
 */
export async function getContactConsent(emailHash: string): Promise<MarketingConsent | null> {
  const snap = await db.collection('Contacts').doc(emailHash).get();
  if (!snap.exists) return null;
  const consent = snap.data()?.['consent'] as { marketing?: MarketingConsent } | undefined;
  return consent?.marketing || 'pending';
}

/** Clear a user link + system-list membership when a user is deleted. */
export async function unlinkUserContact(email: string): Promise<void> {
  const emailHash = computeEmailHash(email);
  const ref = db.collection('Contacts').doc(emailHash);
  const snap = await ref.get();
  if (!snap.exists) return;
  await removeContactFromLists(emailHash, [SYSTEM_LISTS.ALL_USERS, SYSTEM_LISTS.ALL_CUSTOMERS]);
  await ref.set({ userId: FieldValue.delete(), updatedAt: Timestamp.now() }, { merge: true });
}
