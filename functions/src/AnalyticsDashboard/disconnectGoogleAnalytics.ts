import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { OAuth2Client } from 'google-auth-library';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const disconnectGoogleAnalytics = onCall(
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

    // Attempt to revoke the token at Google
    if (settings?.oauth?.refreshToken) {
      try {
        const oauth2Client = new OAuth2Client();
        await oauth2Client.revokeToken(settings.oauth.refreshToken);
      } catch {
        // Token may already be revoked — that's fine
      }
    }

    // Clear OAuth token data but keep clientId/clientSecret for easy reconnect
    // Use set+merge instead of update to avoid crash if doc doesn't exist
    await db.collection('Settings').doc('analytics').set(
      {
        oauth: {
          accessToken: FieldValue.delete(),
          refreshToken: FieldValue.delete(),
          tokenExpiry: FieldValue.delete(),
          scope: FieldValue.delete(),
          connectedAt: FieldValue.delete(),
          connectedBy: FieldValue.delete(),
        },
        isConnected: false,
        selectedProperty: FieldValue.delete(),
        lastError: null,
      },
      { merge: true },
    );

    // Update public status — clear all fields including timestamps
    await db.collection('Settings').doc('analytics_status').set(
      {
        isConnected: false,
        propertyName: null,
        propertyId: null,
        measurementId: null,
        connectedAt: null,
        lastSyncDate: null,
      },
      { merge: true },
    );

    // Clear cached analytics data so stale metrics aren't shown on reconnect
    try {
      await db.collection('AnalyticsDashboards').doc('analyticsData').delete();
    } catch {
      // Non-fatal if the doc doesn't exist
    }

    return { success: true };
  },
);
