import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import type { EmailSettings } from '../types.js';
import { createNotification } from './notifications.js';

/**
 * Fan out an admin alert to every admin user (spec §Phase-5.5).
 *
 * In-app notifications are created for each admin; their email delivery is then
 * decided by onNotificationCreate (the admin_* types default to email on). The
 * whole alert is gated by the `adminAlerts` feature toggle. Best-effort and
 * non-throwing so it never breaks the originating flow.
 */
export async function notifyAdmins(
  type: string,
  payload: { title: string; body: string; link?: string },
): Promise<void> {
  try {
    const settings = (await db.collection('Settings').doc('email').get()).data() as EmailSettings | undefined;
    if (settings?.features?.adminAlerts === false) return;

    const admins = await db.collection('users').where('role', '==', 'admin').get();
    await Promise.all(
      admins.docs.map((d) =>
        createNotification({
          userId: d.data()['uid'],
          type,
          title: payload.title,
          body: payload.body,
          link: payload.link,
          createdBy: 'system',
        }),
      ),
    );
  } catch (err) {
    logger.warn(`notifyAdmins(${type}) failed`, err);
  }
}
