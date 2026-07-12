import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { createNotification } from './notifications.js';
import { getContactConsent } from './contacts.js';
import { computeEmailHash } from './unsubscribeToken.js';

/**
 * Admin → users announcements (spec §Phase-5.3). Fans out an in-app
 * notification (type `announcement`) to the chosen audience; when `sendEmail`
 * is on, the notification also emails (subject to marketing consent).
 *
 * Processes in batches; for very large audiences the first `MAX_TARGETS` are
 * handled here (a continuation hook can be layered on like broadcasts).
 */
const MAX_TARGETS = 2000;

interface Audience {
  kind: 'all' | 'role' | 'list' | 'users';
  role?: string;
  listId?: string;
  userIds?: string[];
}

/** Resolve the audience to a list of {userId, email} recipients. */
async function resolveAudience(audience: Audience): Promise<Array<{ userId: string; email: string }>> {
  const out: Array<{ userId: string; email: string }> = [];

  if (audience.kind === 'users' && audience.userIds?.length) {
    const snap = await db.collection('users').where('uid', 'in', audience.userIds.slice(0, 10)).get();
    snap.docs.forEach((d) => out.push({ userId: d.data()['uid'], email: d.data()['email'] }));
    return out;
  }

  if (audience.kind === 'list' && audience.listId) {
    const snap = await db.collection('Contacts').where('listIds', 'array-contains', audience.listId).limit(MAX_TARGETS).get();
    snap.docs.forEach((d) => {
      const c = d.data();
      if (c['userId'] && c['email']) out.push({ userId: c['userId'], email: c['email'] });
    });
    return out;
  }

  // all / role → users collection
  let q = db.collection('users').limit(MAX_TARGETS) as FirebaseFirestore.Query;
  if (audience.kind === 'role' && audience.role) {
    q = db.collection('users').where('role', '==', audience.role).limit(MAX_TARGETS);
  }
  const snap = await q.get();
  snap.docs.forEach((d) => {
    const u = d.data();
    if (u['uid'] && u['email']) out.push({ userId: u['uid'], email: u['email'] });
  });
  return out;
}

export const sendAnnouncement = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const title = String(request.data?.title || '').trim();
  const body = String(request.data?.body || '').trim();
  const link = request.data?.link ? String(request.data.link) : undefined;
  const sendEmail = request.data?.sendEmail === true;
  const audience: Audience = request.data?.audience || { kind: 'all' };
  if (!title || !body) throw new HttpsError('invalid-argument', 'Title and body are required.');

  const annRef = await db.collection('Announcements').add({
    title, body, link: link || '', audience, sendEmail,
    status: 'sending',
    counts: { targeted: 0, notified: 0, emailed: 0 },
    createdAt: Timestamp.now(),
    createdBy: `admin:${request.auth!.uid}`,
  });

  try {
    const recipients = await resolveAudience(audience);
    let notified = 0;
    let emailed = 0;

    for (const r of recipients) {
      await createNotification({
        userId: r.userId,
        type: 'announcement',
        title,
        body,
        link,
        createdBy: `admin:${request.auth!.uid}`,
        announcementId: annRef.id,
        suppressEmail: !sendEmail,
      });
      notified++;

      // Best-effort emailed estimate: marketing announcement reaches only
      // subscribed contacts (queueEmail enforces this at send time).
      if (sendEmail) {
        const consent = await getContactConsent(computeEmailHash(r.email));
        if (consent !== 'unsubscribed') emailed++;
      }
    }

    await annRef.update({
      status: 'sent',
      sentAt: Timestamp.now(),
      counts: { targeted: recipients.length, notified, emailed },
    });

    logger.info(`sendAnnouncement: ${annRef.id} notified=${notified} emailed=${emailed}`);
    return { announcementId: annRef.id, targeted: recipients.length, notified, emailed };
  } catch (err) {
    logger.error('sendAnnouncement failed', err);
    await annRef.update({ status: 'failed' });
    throw new HttpsError('internal', 'Failed to send announcement.');
  }
});
