import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { ensureDefaultTemplates } from './defaultTemplates.js';

/**
 * Admin callable: seed the default email templates (idempotent).
 *
 * Safe to run repeatedly — only missing template types are created. Used from
 * the admin UI (and can be wired into onboarding) to guarantee every
 * transactional email has a template so sends aren't silently skipped.
 */
export const seedEmailTemplates = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  try {
    const result = await ensureDefaultTemplates();
    logger.info(
      `seedEmailTemplates: created ${result.created.length}, skipped ${result.skipped.length}.`,
    );
    return result;
  } catch (err) {
    logger.error('seedEmailTemplates failed', err);
    throw new HttpsError('internal', 'Failed to seed email templates.');
  }
});
