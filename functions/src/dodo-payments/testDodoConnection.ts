import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { owner } from '../init.js';
import { getDodoSettings, buildDodoClient } from './dodoClient.js';

/**
 * Callable (admin only): validate the stored Dodo Payments credentials by
 * making a lightweight authenticated API call. Lets the settings page surface
 * a connection status without exposing the secret key to the client.
 */
export const testDodoConnection = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const userRecord = await owner.getUser(request.auth.uid);
  if (userRecord.customClaims?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  try {
    const settings = await getDodoSettings();
    const client = buildDodoClient(settings);

    // A minimal authenticated read to confirm the key works.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).products.list({ page_size: 1 });

    return { success: true, mode: settings.mode ?? 'test' };
  } catch (error) {
    logger.warn('Dodo connection test failed', error);
    return { success: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
});
