import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { computeEmailHash } from './unsubscribeToken.js';
import { ensureNotificationTypes } from './notifications.js';

async function resolveUserEmail(uid: string): Promise<string | null> {
  const snap = await db.collection('users').where('uid', '==', uid).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data()['email'] as string) || null;
}

/**
 * Callable: the signed-in user updates their per-type notification email
 * preferences (spec §Phase-5.2). Stored on the user's Contact
 * (`notificationPrefs`, keyed by notification type). Contacts are functions-only
 * so this must go through a callable.
 *
 * Input: { prefs: { [typeKey]: { email: boolean } } }
 */
export const updateMyNotificationPrefs = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const prefs = request.data?.prefs;
  if (!prefs || typeof prefs !== 'object') {
    throw new HttpsError('invalid-argument', 'prefs object is required.');
  }

  const email = await resolveUserEmail(request.auth.uid);
  if (!email) throw new HttpsError('not-found', 'User record not found.');
  const emailHash = computeEmailHash(email);

  // Normalise to { [type]: { email: boolean } } and merge onto the contact.
  const clean: Record<string, { email: boolean }> = {};
  for (const [k, v] of Object.entries(prefs as Record<string, { email?: boolean }>)) {
    clean[k] = { email: v?.email !== false };
  }

  await db.collection('Contacts').doc(emailHash).set(
    { email, emailHash, notificationPrefs: clean, updatedAt: Timestamp.now() },
    { merge: true },
  );
  return { ok: true };
});

/**
 * Callable: the signed-in user reads their configurable notification types +
 * current per-type email prefs. Contacts are functions-only, so users can't read
 * their own prefs directly.
 */
export const getMyNotificationPrefs = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

  await ensureNotificationTypes();
  const typesSnap = await db.collection('Settings').doc('notification_types').get();
  const allTypes = (typesSnap.data()?.['types'] as Record<string, { userConfigurable?: boolean; label?: string; description?: string }>) || {};
  const configurable = Object.entries(allTypes)
    .filter(([, cfg]) => cfg.userConfigurable)
    .map(([key, cfg]) => ({ key, label: cfg.label || key, description: cfg.description || '' }));

  const email = await resolveUserEmail(request.auth.uid);
  let prefs: Record<string, { email?: boolean }> = {};
  if (email) {
    const contact = await db.collection('Contacts').doc(computeEmailHash(email)).get();
    prefs = (contact.data()?.['notificationPrefs'] as Record<string, { email?: boolean }>) || {};
  }

  return { types: configurable, prefs };
});
