import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import { getFirestore } from 'firebase-admin/firestore';
import { AnalyticsPropertyInfo } from '../types.js';

// Debug function to test Analytics connection
export const testAnalyticsConnection = onCall(
  {
    cors: true,
    enforceAppCheck: false,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    try {
      console.log('=== ANALYTICS DEBUG ===');

      // Fetch settings from Firestore
      const db = getFirestore();
      const settingsDoc = await db.collection('Settings').doc('analytics').get();
      const settings = settingsDoc.data();

      if (!settings) {
        return {
          success: false,
          error: 'Analytics settings not found',
        };
      }

      if (!settings.serviceAccountJson) {
        return {
          success: false,
          error: 'Service Account JSON is missing in settings',
        };
      }

      let credentials;
      try {
        credentials = JSON.parse(settings.serviceAccountJson);
      } catch (e) {
        return {
          success: false,
          error: 'Invalid Service Account JSON',
        };
      }

      const PROPERTY_ID = settings.propertyId;

      console.log('Property ID:', PROPERTY_ID);

      if (!PROPERTY_ID) {
        return {
          success: false,
          error: 'No Property ID provided or found in settings',
        };
      }

      // Initialize auth
      const auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      });

      const analyticsSource = await getAnalyticsPropertyInfo(PROPERTY_ID, auth);

      // Replace undefined values with empty strings for safe serialization
      if (analyticsSource) {
        for (const key of Object.keys(analyticsSource) as (keyof AnalyticsPropertyInfo)[]) {
          if (analyticsSource[key] === undefined) {
            (analyticsSource as unknown as Record<string, unknown>)[key] = '';
          }
        }
      }

      console.log('=== SOURCE ANALYTICS DASHBOARD ===', analyticsSource);

      // Get service account email
      const authClient = await auth.getClient();
      const serviceAccountEmail = (authClient as { email?: string }).email;

      // Initialize Analytics
      const analyticsData = google.analyticsdata({ version: 'v1beta', auth: auth });

      // Test 1: Try to get metadata
      console.log('Test 1: Getting property metadata...');
      try {
        await analyticsData.properties.getMetadata({
          name: `properties/${PROPERTY_ID}/metadata`,
        });
        console.log('✅ Metadata test successful');
      } catch (metadataError: unknown) {
        const msg = metadataError instanceof Error ? metadataError.message : String(metadataError);
        console.log('❌ Metadata test failed:', msg);
      }

      // Test 2: Try a simple report
      console.log('Test 2: Running simple report...');
      try {
        const reportResponse = await analyticsData.properties.runReport({
          property: `properties/${PROPERTY_ID}`,
          requestBody: {
            dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
            metrics: [{ name: 'sessions' }],
          },
        });
        console.log('✅ Report test successful');
        console.log('Sessions data:', reportResponse.data.rows?.[0]?.metricValues?.[0]?.value || 'No data');

        return {
          success: true,
          serviceAccountEmail,
          propertyId: PROPERTY_ID,
          hasData: (reportResponse.data.rows?.length || 0) > 0,
          sessions: reportResponse.data.rows?.[0]?.metricValues?.[0]?.value || 'No data',
          analyticsSource: analyticsSource || {},
        };
      } catch (reportError: unknown) {
        const msg = reportError instanceof Error ? reportError.message : String(reportError);
        const code = (reportError as { code?: number }).code;
        const status = (reportError as { status?: string }).status;
        console.log('❌ Report test failed:', msg);

        return {
          success: false,
          serviceAccountEmail,
          propertyId: PROPERTY_ID,
          error: msg,
          errorDetails: {
            code,
            status,
            message: msg,
          },
        };
      }
    } catch (error: unknown) {
      console.error('Debug function error:', error);
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: msg,
      };
    }
  },
);

async function getAnalyticsPropertyInfo(propertyId: string, auth: GoogleAuth): Promise<AnalyticsPropertyInfo> {
  try {
    const analyticsAdmin = google.analyticsadmin({
      version: 'v1beta',
      auth,
    });

    // Get property details
    const propertyResponse = await analyticsAdmin.properties.get({
      name: `properties/${propertyId}`,
    });

    const property = propertyResponse.data;

    console.log('Property Information:');
    console.log('- Property ID:', propertyId);
    console.log('- Property Name:', property.displayName);
    console.log('- Parent Account:', property.parent);
    console.log('- Industry Category:', property.industryCategory);
    console.log('- Property Type:', property.propertyType);
    console.log('- Time Zone:', property.timeZone);
    console.log('- Currency Code:', property.currencyCode);

    // Get account details to find the parent account
    if (property.parent) {
      const accountId = property.parent.replace('accounts/', '');
      const accountResponse = await analyticsAdmin.accounts.get({
        name: property.parent,
      });

      const account = accountResponse.data;
      console.log('Account Information:');
      console.log('- Account ID:', accountId);
      console.log('- Account Name:', account.displayName);
      console.log('- Account Region:', account.regionCode);
    }

    return {
      propertyId,
      propertyName: property.displayName,
      parentAccount: property.parent,
      timeZone: property.timeZone,
      currencyCode: property.currencyCode,
      industryCategory: property.industryCategory,
    };
  } catch (error) {
    console.error('Error fetching property info:', error);
    throw error;
  }
}
