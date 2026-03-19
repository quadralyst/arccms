import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { EmailSettings } from '../types.js';

/**
 * Scheduled cloud function that runs daily at 2:00 AM UTC.
 * Automatically purges email logs older than the configured retention period.
 * Reads configuration from Settings/email.autoPurge.
 * Falls back to 60 days if not configured.
 */
export const scheduledPurgeEmailLogs = onSchedule(
    {
        schedule: 'every day 02:00',
        timeZone: 'UTC',
    },
    async () => {
        // Read auto-purge config from Settings
        let retentionDays = 60;
        let isEnabled = true;

        try {
            const settingsSnap = await db.collection('Settings').doc('email').get();
            const settings = settingsSnap.data() as EmailSettings | undefined;
            if (settings?.autoPurge) {
                isEnabled = settings.autoPurge.enabled !== false;
                retentionDays = settings.autoPurge.retentionDays || 60;
            }
        } catch (err) {
            console.warn('scheduledPurgeEmailLogs: Could not read settings, using defaults:', err);
        }

        if (!isEnabled) {
            console.log('scheduledPurgeEmailLogs: Auto-purge is disabled in settings.');
            return;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

        const batchSize = 500;
        let totalDeleted = 0;
        let hasMore = true;

        while (hasMore) {
            const snapshot = await db
                .collection('EmailLogs')
                .where('createdAt', '<', cutoffTimestamp)
                .limit(batchSize)
                .get();

            if (snapshot.empty) {
                hasMore = false;
                break;
            }

            const batch = db.batch();
            snapshot.docs.forEach((doc) => batch.delete(doc.ref));
            try {
                await batch.commit();
                totalDeleted += snapshot.size;
            } catch (err) {
                console.error(`scheduledPurgeEmailLogs: Batch commit failed for ${snapshot.size} docs:`, err);
            }

            if (snapshot.size < batchSize) {
                hasMore = false;
            }
        }

        console.log(
            `scheduledPurgeEmailLogs: Deleted ${totalDeleted} email logs older than ${retentionDays} days.`,
        );
    },
);
