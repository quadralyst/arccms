import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { createOAuth2Client, fetchAndStoreAnalyticsData } from './analyticsHelpers.js';

export const selectAnalyticsProperty = onCall(
  { cors: true, enforceAppCheck: false },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    if (request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin access required.');
    }

    const { propertyId, displayName } = request.data;

    if (!propertyId) {
      throw new HttpsError('invalid-argument', 'Property ID is required.');
    }

    const db = getFirestore();
    const settingsDoc = await db.collection('Settings').doc('analytics').get();
    const settings = settingsDoc.data();

    if (!settings?.isConnected || !settings?.oauth?.refreshToken) {
      throw new HttpsError('failed-precondition', 'Google Analytics is not connected.');
    }

    try {
      // Look up the measurement ID for this property from its data streams
      const { clientId, clientSecret, refreshToken } = settings.oauth;
      const oauth2Client = createOAuth2Client(clientId, clientSecret, refreshToken);
      let detectedMeasurementId: string | null = null;
      try {
        const analyticsAdmin = google.analyticsadmin({ version: 'v1beta', auth: oauth2Client });
        const streamsResponse = await analyticsAdmin.properties.dataStreams.list({
          parent: `properties/${propertyId}`,
        });
        const webStream = (streamsResponse.data.dataStreams || []).find(
          (s: any) => s.webStreamData?.measurementId,
        );
        detectedMeasurementId = webStream?.webStreamData?.measurementId || null;
      } catch {
        // Non-fatal: measurement ID lookup failed, continue without it
      }

      // Update selected property
      await db.collection('Settings').doc('analytics').update({
        selectedProperty: { propertyId, displayName, measurementId: detectedMeasurementId },
      });

      await db.collection('Settings').doc('analytics_status').set(
        {
          propertyId,
          propertyName: displayName || null,
          measurementId: detectedMeasurementId,
        },
        { merge: true },
      );

      // Clear stale cached analytics data before fetching for the new property
      try {
        await db.collection('AnalyticsDashboards').doc('analyticsData').delete();
      } catch {
        // Non-fatal if doc doesn't exist
      }

      // Fetch data for the new property (reuses oauth2Client from above)
      await fetchAndStoreAnalyticsData(db, oauth2Client, propertyId);

      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);

      // Handle token revocation / expiry (same logic as refreshAnalyticsData)
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

      console.error('selectAnalyticsProperty error:', error);
      throw new HttpsError('internal', 'Failed to select property. Please try again.');
    }
  },
);
