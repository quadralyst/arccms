import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import type { BroadcastAudience } from '../types.js';
import { countEligible } from './broadcastAudience.js';

/**
 * Admin callable: preview how many recipients a broadcast audience will reach
 * (Phase 6.1) — respecting marketing consent. Bounded scan for large lists.
 */
export const previewBroadcastAudience = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }
  const audience = request.data?.audience as BroadcastAudience | undefined;
  if (!audience || (audience.kind === 'list' && !audience.listId) || (audience.kind === 'waitlist' && !audience.waitlistId)) {
    throw new HttpsError('invalid-argument', 'A valid audience is required.');
  }

  try {
    const { count, scanned, capped } = await countEligible(audience);
    return { eligible: count, scanned, capped };
  } catch (err) {
    logger.error('previewBroadcastAudience failed', err);
    throw new HttpsError('internal', 'Failed to preview audience.');
  }
});
