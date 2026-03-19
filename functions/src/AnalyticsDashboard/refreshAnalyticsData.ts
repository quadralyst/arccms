import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { createOAuth2Client, fetchAndStoreAnalyticsData } from './analyticsHelpers.js';

export const refreshAnalyticsData = onCall(
  { cors: true, enforceAppCheck: false },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    if (request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin access required.');
    }

    const db = getFirestore();
    const settingsDoc = await db.collection('Settings').doc('analytics').get();
    const settings = settingsDoc.data();

    if (!settings?.isConnected) {
      throw new HttpsError('failed-precondition', 'Google Analytics is not connected.');
    }

    const oauth = settings.oauth;
    if (!oauth?.refreshToken || !oauth?.clientId || !oauth?.clientSecret) {
      throw new HttpsError(
        'failed-precondition',
        'OAuth credentials are incomplete. Please reconnect Google Analytics.',
      );
    }

    const propertyId = settings.selectedProperty?.propertyId;
    if (!propertyId) {
      throw new HttpsError('failed-precondition', 'No GA4 property selected.');
    }

    try {
      const oauth2Client = createOAuth2Client(oauth.clientId, oauth.clientSecret, oauth.refreshToken);

      await fetchAndStoreAnalyticsData(db, oauth2Client, propertyId);

      // Update stored access token if it was refreshed
      const newCredentials = oauth2Client.credentials;
      if (newCredentials.access_token && newCredentials.access_token !== oauth.accessToken) {
        await db.collection('Settings').doc('analytics').update({
          'oauth.accessToken': newCredentials.access_token,
          'oauth.tokenExpiry': newCredentials.expiry_date,
        });
      }

      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);

      // Handle token revocation / expiry
      if (
        msg.includes('invalid_grant') ||
        msg.includes('Token has been expired or revoked') ||
        (error as any)?.code === 401
      ) {
        await db.collection('Settings').doc('analytics').update({
          isConnected: false,
          lastError: 'Access revoked. Please reconnect Google Analytics.',
        });
        await db.collection('Settings').doc('analytics_status').set(
          { isConnected: false },
          { merge: true },
        );
        throw new HttpsError(
          'unauthenticated',
          'Google Analytics access has been revoked. Please reconnect.',
        );
      }

      console.error('refreshAnalyticsData error:', error);
      throw new HttpsError('internal', 'Failed to refresh analytics data. Please try again later.');
    }
  },
);
