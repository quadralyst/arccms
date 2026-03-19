import { google, analyticsdata_v1beta } from 'googleapis';
import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { MetricCard, ListCard, ListItem } from '../types.js';

/**
 * GA4 metric names mapped to their dashboard display info.
 * Order matters — this determines the order of cards on the dashboard.
 */
const METRIC_DEFINITIONS = [
  // Row 1: Traffic
  { gaName: 'totalUsers', title: 'Users', icon: 'fas fa-user' },
  { gaName: 'newUsers', title: 'New Users', icon: 'fas fa-user-plus' },
  { gaName: 'sessions', title: 'Sessions', icon: 'fas fa-users' },
  // Row 2: Engagement
  { gaName: 'bounceRate', title: 'Bounce Rate', icon: 'fas fa-percentage' },
  { gaName: 'averageSessionDuration', title: 'Avg. Duration', icon: 'fas fa-clock' },
  { gaName: 'screenPageViewsPerSession', title: 'Pages/Session', icon: 'fas fa-layer-group' },
  // Row 3: Outcomes
  { gaName: 'screenPageViews', title: 'Pageviews', icon: 'fas fa-eye' },
  { gaName: 'eventCount', title: 'Event Count', icon: 'fas fa-bolt' },
  { gaName: 'engagedSessions', title: 'Engaged Sessions', icon: 'fas fa-heart' },
];

/**
 * Fetch GA4 analytics data and store in the AnalyticsDashboards Firestore collection.
 */
export async function fetchAndStoreAnalyticsData(
  db: Firestore,
  authClient: OAuth2Client,
  propertyId: string,
): Promise<void> {
  const analyticsData = google.analyticsdata({ version: 'v1beta', auth: authClient });

  // Query with two date ranges: current (28 days) and previous (28 days before that) for comparison
  const response = await analyticsData.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [
        { startDate: '28daysAgo', endDate: 'today' },
        { startDate: '56daysAgo', endDate: '29daysAgo' },
      ],
      metrics: METRIC_DEFINITIONS.map((m) => ({ name: m.gaName })),
    },
  });

  const metrics = buildMetricCards(response.data);

  // Fetch acquisition insight panels in parallel
  const acquisitionPanels = await fetchAcquisitionPanels(analyticsData, propertyId);

  // Calculate actual date range for display
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 28);

  // Merge so that createdAt is preserved across refreshes
  const docRef = db.collection('AnalyticsDashboards').doc('analyticsData');
  const existing = await docRef.get();

  const docData: Record<string, unknown> = {
    id: 'analyticsData',
    metrics,
    acquisitionPanels,
    dateRange: {
      startDate: startDate,
      endDate: now,
    },
    lastSyncDate: FieldValue.serverTimestamp(),
    propertyId,
    modifiedAt: FieldValue.serverTimestamp(),
    modifiedBy: 'system',
  };

  // Set createdAt on first write — required for frontend orderBy('createdAt') query
  if (!existing.exists) {
    docData['createdAt'] = FieldValue.serverTimestamp();
    docData['createdBy'] = 'system';
  }

  await docRef.set(docData, { merge: true });

  // Update status doc with last sync
  await db.collection('Settings').doc('analytics_status').set(
    { lastSyncDate: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/**
 * Transform raw GA4 runReport response into MetricCard[] format.
 */
export function buildMetricCards(data: analyticsdata_v1beta.Schema$RunReportResponse): MetricCard[] {
  const rows = data.rows || [];
  if (rows.length === 0) return getEmptyMetrics();

  // Row 0 contains all metric values.
  // dateRangeValues[0] = current period, dateRangeValues[1] = previous period
  const row = rows[0];
  const currentValues = row.metricValues || [];

  // If we have a comparison period (second date range), values are interleaved or in separate rows.
  // With the GA4 Data API, when using multiple date ranges, the response has one row per date range.
  // Row 0 = first date range (current), Row 1 = second date range (previous)
  const previousRow = rows.length > 1 ? rows[1] : null;
  const previousValues = previousRow?.metricValues || [];

  return METRIC_DEFINITIONS.map((def, index) => {
    const currentRaw = parseFloat(currentValues[index]?.value || '0');
    const previousRaw = previousValues[index] ? parseFloat(previousValues[index].value || '0') : null;

    const value = formatMetricValue(def.gaName, currentRaw);
    const { change, changeType } = calculateChange(def.gaName, currentRaw, previousRaw);

    return {
      title: def.title,
      value,
      icon: def.icon,
      change,
      changeType,
    };
  });
}

/**
 * Acquisition panel definitions for dimension-based reports.
 */
const ACQUISITION_PANELS = [
  {
    title: 'Top Pages',
    icon: 'bi bi-file-earmark-text',
    dimension: 'pagePath',
    metric: 'screenPageViews',
    limit: 10,
  },
  {
    title: 'Traffic Sources',
    icon: 'bi bi-signpost-split',
    dimension: 'sessionDefaultChannelGroup',
    metric: 'sessions',
    limit: 8,
  },
  {
    title: 'Devices',
    icon: 'bi bi-laptop',
    dimension: 'deviceCategory',
    metric: 'sessions',
    limit: 5,
  },
  {
    title: 'Top Countries',
    icon: 'bi bi-globe',
    dimension: 'country',
    metric: 'sessions',
    limit: 10,
  },
];

/**
 * Fetch acquisition insight panels (Top Pages, Traffic Sources, Devices, Countries).
 * Each panel runs a separate dimension-based runReport call, all in parallel.
 */
async function fetchAcquisitionPanels(
  analyticsDataClient: analyticsdata_v1beta.Analyticsdata,
  propertyId: string,
): Promise<ListCard[]> {
  try {
    const panelPromises = ACQUISITION_PANELS.map(async (panel) => {
      const response = await analyticsDataClient.properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
          dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
          dimensions: [{ name: panel.dimension }],
          metrics: [{ name: panel.metric }],
          orderBys: [{ metric: { metricName: panel.metric }, desc: true }],
          limit: String(panel.limit),
        },
      });

      const rows = response.data?.rows || [];
      const items: ListItem[] = rows.map((row: analyticsdata_v1beta.Schema$Row) => ({
        name: row.dimensionValues?.[0]?.value || '(unknown)',
        value: parseInt(row.metricValues?.[0]?.value || '0', 10),
        percentage: 0, // calculated below
      }));

      // Calculate percentage relative to the highest value
      const maxValue = items.length > 0 ? items[0].value : 1;
      items.forEach((item) => {
        item.percentage = maxValue > 0 ? Math.round((item.value / maxValue) * 100) : 0;
      });

      return {
        title: panel.title,
        icon: panel.icon,
        items,
      } as ListCard;
    });

    return await Promise.all(panelPromises);
  } catch (error) {
    console.error('Error fetching acquisition panels:', error);
    // Return empty panels on error rather than failing the entire refresh
    return ACQUISITION_PANELS.map((panel) => ({
      title: panel.title,
      icon: panel.icon,
      items: [],
    }));
  }
}

/**
 * Format a raw metric value for display.
 */
function formatMetricValue(gaName: string, raw: number): string {
  switch (gaName) {
    case 'bounceRate':
      return `${(raw * 100).toFixed(1)}%`;
    case 'averageSessionDuration':
      return formatDuration(raw);
    case 'screenPageViewsPerSession':
      return raw.toFixed(1);
    default:
      return formatNumber(raw);
  }
}

/**
 * Format seconds into a human-readable duration string.
 */
function formatDuration(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Format a number with comma separators.
 */
function formatNumber(num: number): string {
  return Math.round(num).toLocaleString('en-US');
}

/**
 * Calculate the percentage change between current and previous values.
 */
function calculateChange(
  gaName: string,
  current: number,
  previous: number | null,
): { change: string; changeType: 'positive' | 'negative' } {
  if (previous === null || previous === 0) {
    return { change: '', changeType: 'positive' };
  }

  let percentChange: number;
  if (gaName === 'bounceRate') {
    // bounceRate is a ratio (0-1), calculate absolute difference in percentage points
    percentChange = ((current - previous) * 100);
  } else {
    percentChange = ((current - previous) / previous) * 100;
  }

  const isPositive = percentChange >= 0;
  // For bounce rate, a decrease is positive (good)
  const isGood = gaName === 'bounceRate' ? !isPositive : isPositive;

  return {
    change: `${isPositive ? '+' : ''}${percentChange.toFixed(1)}%`,
    changeType: isGood ? 'positive' : 'negative',
  };
}

/**
 * Return empty metric cards when no data is available.
 */
function getEmptyMetrics(): MetricCard[] {
  return METRIC_DEFINITIONS.map((def) => ({
    title: def.title,
    value: '0',
    icon: def.icon,
    change: '',
    changeType: 'positive' as const,
  }));
}

/**
 * Create an OAuth2Client with stored credentials.
 */
export function createOAuth2Client(
  clientId: string,
  clientSecret: string,
  refreshToken?: string,
): OAuth2Client {
  const client = new OAuth2Client(clientId, clientSecret);
  if (refreshToken) {
    client.setCredentials({ refresh_token: refreshToken });
  }
  return client;
}
