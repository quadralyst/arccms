/**
 * The scheduled tasks every install has, whatever its features (scheduled/tasks.ts).
 * A feature's own tasks are in feature-tasks/<id>.ts.
 */
import { retryPendingEmails } from '../email-core/retryPendingEmails.js';
import { sendAdminDigest } from '../email-core/sendAdminDigest.js';
import { scheduledPurgeEmailLogs } from '../email-log/scheduledPurgeEmailLogs.js';
import type { ArcTask } from './tasks.js';

export const CORE_TASKS: readonly ArcTask[] = [
    // Emails whose next attempt is due: a failed send, or one held back by the daily quota.
    { name: 'retryPendingEmails', when: { every: 5 }, run: retryPendingEmails },
    // Sends only in the hour the email settings choose, when the digest is on.
    { name: 'sendAdminDigest', when: { hourly: 0 }, run: sendAdminDigest },
    { name: 'scheduledPurgeEmailLogs', when: { daily: '02:00' }, run: scheduledPurgeEmailLogs },
];
