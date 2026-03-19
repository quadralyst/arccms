import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { fetchAndStoreAnalyticsData } from './analyticsHelpers.js';

export const connectGoogleAnalytics = onCall(
  { cors: true, enforceAppCheck: false },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    // Only admins can connect analytics
    if (request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin access required.');
    }

    const { authorizationCode, redirectUri, measurementId } = request.data;

    if (!authorizationCode) {
      throw new HttpsError('invalid-argument', 'Authorization code is required.');
    }

    const db = getFirestore();

    // 1. Read OAuth client credentials from Settings/analytics
    const settingsDoc = await db.collection('Settings').doc('analytics').get();
    const settings = settingsDoc.data();
    const clientId = settings?.oauth?.clientId;
    const clientSecret = settings?.oauth?.clientSecret;

    if (!clientId || !clientSecret) {
      throw new HttpsError(
        'failed-precondition',
        'OAuth client ID and secret not configured. Go to Settings > Analytics to set them up.',
      );
    }

    try {
      // 2. Exchange authorization code for tokens
      const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri || 'postmessage');
      const { tokens } = await oauth2Client.getToken(authorizationCode);

      if (!tokens.refresh_token) {
        throw new HttpsError(
          'failed-precondition',
          'No refresh token received. Please revoke access at https://myaccount.google.com/permissions and try again.',
        );
      }

      oauth2Client.setCredentials(tokens);

      // 3. List all GA4 properties the user has access to
      const analyticsAdmin = google.analyticsadmin({ version: 'v1beta', auth: oauth2Client });
      const accountsResponse = await analyticsAdmin.accounts.list();
      const accounts = accountsResponse.data.accounts || [];

      interface PropertyInfo {
        propertyId: string;
        displayName: string | null | undefined;
        accountName: string | null | undefined;
      }

      const allProperties: PropertyInfo[] = [];

      for (const account of accounts) {
        const propsResponse = await analyticsAdmin.properties.list({
          filter: `parent:${account.name}`,
        });
        for (const prop of propsResponse.data.properties || []) {
          allProperties.push({
            propertyId: prop.name?.replace('properties/', '') || '',
            displayName: prop.displayName,
            accountName: account.displayName,
          });
        }
      }

      // 4. Auto-detect property matching measurementId
      let selectedProperty = null;

      if (measurementId) {
        for (const prop of allProperties) {
          try {
            const streamsResponse = await analyticsAdmin.properties.dataStreams.list({
              parent: `properties/${prop.propertyId}`,
            });
            const matchingStream = (streamsResponse.data.dataStreams || []).find(
              (s: any) => s.webStreamData?.measurementId === measurementId,
            );
            if (matchingStream) {
              selectedProperty = {
                propertyId: prop.propertyId,
                displayName: prop.displayName,
                measurementId: matchingStream.webStreamData?.measurementId,
              };
              break;
            }
          } catch {
            // Skip properties we can't list streams for
            continue;
          }
        }
      }

      // 5. Store tokens and connection info
      await db.collection('Settings').doc('analytics').set(
        {
          authMethod: 'oauth',
          oauth: {
            clientId,
            clientSecret,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            tokenExpiry: tokens.expiry_date,
            scope: tokens.scope,
            connectedAt: FieldValue.serverTimestamp(),
            connectedBy: request.auth.uid,
          },
          selectedProperty: selectedProperty || null,
          isConnected: true,
          lastError: null,
        },
        { merge: true },
      );

      // 6. Update public status doc
      await db.collection('Settings').doc('analytics_status').set(
        {
          isConnected: true,
          propertyName: selectedProperty?.displayName || null,
          propertyId: selectedProperty?.propertyId || null,
          measurementId: selectedProperty?.measurementId || null,
          connectedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      // 7. Clear stale cached analytics data before fetching for the new property
      try {
        await db.collection('AnalyticsDashboards').doc('analyticsData').delete();
      } catch {
        // Non-fatal if doc doesn't exist
      }

      // 8. Fetch initial data if a property was selected
      if (selectedProperty) {
        try {
          await fetchAndStoreAnalyticsData(db, oauth2Client, selectedProperty.propertyId);
        } catch (fetchError) {
          console.error('Initial data fetch failed (non-fatal):', fetchError);
          // Don't fail the connection just because the initial fetch had issues
        }
      }

      return {
        success: true,
        selectedProperty,
        allProperties: allProperties.map((p) => ({
          propertyId: p.propertyId,
          displayName: p.displayName,
          accountName: p.accountName,
        })),
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      console.error('connectGoogleAnalytics error:', error);
      throw new HttpsError('internal', 'Failed to connect Google Analytics. Please check your credentials and try again.');
    }
  },
);
