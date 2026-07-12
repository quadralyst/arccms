import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { EmailCategory } from '../types.js';

/**
 * Notification core (spec §3.8–3.9, Phase 5).
 *
 * `createNotification()` writes a `Notifications` doc; the `onNotificationCreate`
 * trigger then decides whether to also deliver it by email. The type registry
 * (`Settings/notification_types`) controls channels, category and whether users
 * can configure it.
 */

export interface NotificationTypeConfig {
  label: string;
  description: string;
  category: EmailCategory;
  defaultChannels: { inApp: boolean; email: boolean };
  userConfigurable: boolean;
  emailTemplateType?: string;
  enabled: boolean;
}

export type NotificationCreatedBy = 'system' | `admin:${string}` | `event:${string}`;

export interface CreateNotificationParams {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  icon?: string;
  createdBy?: NotificationCreatedBy;
  announcementId?: string;
  /** Force in-app only for this notification (e.g. an announcement with email off). */
  suppressEmail?: boolean;
}

/** Seeded notification types (spec §3.9). */
export const DEFAULT_NOTIFICATION_TYPES: Record<string, NotificationTypeConfig> = {
  payment_succeeded: {
    label: 'Payment succeeded', description: 'A payment or renewal went through.',
    category: 'transactional', defaultChannels: { inApp: true, email: true },
    userConfigurable: false, enabled: true,
  },
  payment_failed: {
    label: 'Payment failed', description: 'A payment could not be processed.',
    category: 'transactional', defaultChannels: { inApp: true, email: true },
    userConfigurable: false, enabled: true,
  },
  subscription_changed: {
    label: 'Subscription changed', description: 'Your subscription status changed.',
    category: 'transactional', defaultChannels: { inApp: true, email: true },
    userConfigurable: true, enabled: true,
  },
  trial_ending: {
    label: 'Trial ending', description: 'Your free trial is ending soon.',
    category: 'transactional', defaultChannels: { inApp: true, email: true },
    userConfigurable: true, enabled: true,
  },
  updates_ending: {
    label: 'Updates ending', description: 'Your included updates window is ending.',
    category: 'transactional', defaultChannels: { inApp: true, email: true },
    userConfigurable: true, enabled: true,
  },
  announcement: {
    label: 'Announcements', description: 'News and announcements from the team.',
    category: 'marketing', defaultChannels: { inApp: true, email: true },
    userConfigurable: true, enabled: true,
  },
  admin_new_signup: {
    label: 'New signup (admin)', description: 'A new user signed up.',
    category: 'transactional', defaultChannels: { inApp: true, email: true },
    userConfigurable: false, enabled: true,
  },
  admin_payment_received: {
    label: 'Payment received (admin)', description: 'A customer paid.',
    category: 'transactional', defaultChannels: { inApp: true, email: true },
    userConfigurable: false, enabled: true,
  },
  admin_payment_failed: {
    label: 'Payment failed (admin)', description: 'A customer payment failed.',
    category: 'transactional', defaultChannels: { inApp: true, email: true },
    userConfigurable: false, enabled: true,
  },
  admin_webhook_failure: {
    label: 'Webhook failure (admin)', description: 'A provider webhook failed to process.',
    category: 'transactional', defaultChannels: { inApp: true, email: true },
    userConfigurable: false, enabled: true,
  },
};

/** Idempotently seed the notification-type registry (missing keys only). */
export async function ensureNotificationTypes(): Promise<void> {
  const ref = db.collection('Settings').doc('notification_types');
  const snap = await ref.get();
  const existing = (snap.data()?.['types'] as Record<string, NotificationTypeConfig>) || {};
  const merged = { ...DEFAULT_NOTIFICATION_TYPES };
  // Keep any admin-customised configs; only add missing defaults.
  for (const [k, v] of Object.entries(existing)) merged[k] = v;
  await ref.set({ types: merged }, { merge: true });
}

/** Read a single notification type's config (null if unknown). */
export async function getNotificationTypeConfig(type: string): Promise<NotificationTypeConfig | null> {
  const snap = await db.collection('Settings').doc('notification_types').get();
  const types = (snap.data()?.['types'] as Record<string, NotificationTypeConfig>) || {};
  return types[type] || DEFAULT_NOTIFICATION_TYPES[type] || null;
}

/**
 * Create a `Notifications` doc (in-app). Email delivery, if any, is decided by
 * the `onNotificationCreate` trigger. Returns the new doc id.
 */
export async function createNotification(params: CreateNotificationParams): Promise<string> {
  const doc: Record<string, unknown> = {
    userId: params.userId,
    type: params.type,
    title: params.title,
    body: params.body,
    read: false,
    createdAt: Timestamp.now(),
    createdBy: params.createdBy || 'system',
  };
  if (params.link) doc['link'] = params.link;
  if (params.icon) doc['icon'] = params.icon;
  if (params.announcementId) doc['announcementId'] = params.announcementId;
  if (params.suppressEmail) doc['suppressEmail'] = true;

  const ref = await db.collection('Notifications').add(doc);
  return ref.id;
}
