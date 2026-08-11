import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * Global contact tags (audience-unification spec U2, U-D8).
 *
 * Tags are labels on the *contact*, not on a form membership — the industry
 * model (Kit, MailerLite): one audience, tags layered on top, so "everyone
 * tagged vip" spans every form and list. This replaces the per-waitlist
 * `WaitlistUserTags_{waitlistId}` collections, where the same "VIP" existed as a
 * different tag per form and could never be targeted together.
 *
 * Named `ContactTags`, not `Tags`: the CMS already owns `Tags_{slug}` content
 * taxonomy collections with their own public-read wildcard rule, and a bare
 * `Tags` sitting next to those is a rules mistake waiting to happen.
 *
 * Doc id is a slug of the label, which is what merges the per-form duplicates on
 * migration: waitlist A's "VIP" and waitlist B's "vip" both resolve to `vip`.
 */

export interface ContactTag {
  id: string;
  label: string;
  color: string;
  usageCount: number;
}

const DEFAULT_TAG_COLOR = '#6b7280';

/**
 * Deterministic doc id for a tag label.
 *
 * Lowercase, non-alphanumerics collapsed to single dashes, trimmed. Returns ''
 * for a label with nothing sluggable (e.g. "!!!") so callers can reject it
 * rather than write a doc with an empty id.
 */
export function tagIdFromLabel(label: string): string {
  return (label || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Create the tag if it's new; never clobber an existing label/color, so a
 * migration merging several per-form copies keeps the first one's styling and
 * an admin's later rename survives a re-run.
 */
export async function ensureTag(label: string, color?: string): Promise<string | null> {
  const id = tagIdFromLabel(label);
  if (!id) return null;

  const ref = db.collection('ContactTags').doc(id);
  const snap = await ref.get();
  if (snap.exists) return id;

  const now = Timestamp.now();
  await ref.set({
    id,
    label: label.trim(),
    color: color || DEFAULT_TAG_COLOR,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/**
 * Add tags to a contact (the single sanctioned tagging path).
 *
 * Mirrors addContactToLists: only tags the contact doesn't already carry bump
 * `usageCount`, so repeated calls are idempotent.
 */
export async function addTagsToContact(emailHash: string, tagIds: string[]): Promise<string[]> {
  const wanted = [...new Set(tagIds.filter(Boolean))];
  if (!wanted.length) return [];
  const ref = db.collection('Contacts').doc(emailHash);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return [];
    const current: string[] = (snap.data()?.['tags'] as string[]) || [];
    const toAdd = wanted.filter((id) => !current.includes(id));
    if (!toAdd.length) return [];

    txn.update(ref, { tags: FieldValue.arrayUnion(...toAdd), updatedAt: Timestamp.now() });
    for (const tagId of toAdd) {
      txn.set(
        db.collection('ContactTags').doc(tagId),
        { usageCount: FieldValue.increment(1), updatedAt: Timestamp.now() },
        { merge: true },
      );
    }
    return toAdd;
  });
}

/** Remove tags from a contact, keeping `usageCount` honest. */
export async function removeTagsFromContact(emailHash: string, tagIds: string[]): Promise<string[]> {
  const wanted = [...new Set(tagIds.filter(Boolean))];
  if (!wanted.length) return [];
  const ref = db.collection('Contacts').doc(emailHash);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return [];
    const current: string[] = (snap.data()?.['tags'] as string[]) || [];
    const toRemove = wanted.filter((id) => current.includes(id));
    if (!toRemove.length) return [];

    txn.update(ref, { tags: FieldValue.arrayRemove(...toRemove), updatedAt: Timestamp.now() });
    for (const tagId of toRemove) {
      txn.set(
        db.collection('ContactTags').doc(tagId),
        { usageCount: FieldValue.increment(-1), updatedAt: Timestamp.now() },
        { merge: true },
      );
    }
    return toRemove;
  });
}

/** Replace a contact's tags wholesale (admin edit); diffs so counts stay right. */
export async function setContactTags(emailHash: string, tagIds: string[]): Promise<void> {
  const wanted = [...new Set(tagIds.filter(Boolean))];
  const snap = await db.collection('Contacts').doc(emailHash).get();
  if (!snap.exists) return;
  const current: string[] = (snap.data()?.['tags'] as string[]) || [];

  await addTagsToContact(emailHash, wanted.filter((id) => !current.includes(id)));
  await removeTagsFromContact(emailHash, current.filter((id) => !wanted.includes(id)));
}
