import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { ensureDefaultTemplates } from './defaultTemplates.js';
import { ensureNotificationTypes } from './notifications.js';
import { ensureEventMappings } from './appEvents.js';
import { ensureSystemLists } from './contacts.js';
import { isFeatureOn } from '../feature-flags.js';
import { isArcAdmin } from '../users/claims.js';

/**
 * Admin callable: seed the whole email system's default config (idempotent).
 *
 * Templates, the notification-type registry, event mappings and the system
 * lists. Safe to run repeatedly — only missing entries are created. Used from
 * the admin UI (and can be wired into onboarding).
 */
export const seedEmailTemplates = onCall(async (request) => {
  if (!isArcAdmin(request.auth?.token)) {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  try {
    const result = await ensureDefaultTemplates();
    await ensureNotificationTypes();
    await ensureEventMappings();
    // System lists are the audience feature's (specs/feature-flags-spec.md).
    if (isFeatureOn('audience')) await ensureSystemLists();
    logger.info(
      `seedEmailTemplates: created ${result.created.length}, skipped ${result.skipped.length}; seeded registries + system lists.`,
    );
    return result;
  } catch (err) {
    logger.error('seedEmailTemplates failed', err);
    throw new HttpsError('internal', 'Failed to seed email system.');
  }
});
