/**
 * Tests for analyticsHelpers — buildMetricCards, formatMetricValue, calculateChange.
 *
 * buildMetricCards is the only exported pure function we can unit-test directly.
 * It internally calls formatMetricValue and calculateChange, so exercising it with
 * various GA4 response shapes gives us coverage over all three.
 */
import { describe, it, expect } from 'vitest';
import { buildMetricCards } from '../AnalyticsDashboard/analyticsHelpers.js';
import type { analyticsdata_v1beta } from 'googleapis';

// Helper: build a minimal GA4 RunReportResponse with one or two date-range rows
function makeGaResponse(
  currentValues: string[],
  previousValues?: string[],
): analyticsdata_v1beta.Schema$RunReportResponse {
  const rows: analyticsdata_v1beta.Schema$Row[] = [
    { metricValues: currentValues.map((v) => ({ value: v })) },
  ];
  if (previousValues) {
    rows.push({ metricValues: previousValues.map((v) => ({ value: v })) });
  }
  return { rows };
}

describe('buildMetricCards', () => {
  // The 9 metrics in order:
  // totalUsers, newUsers, sessions, bounceRate, averageSessionDuration,
  // screenPageViewsPerSession, screenPageViews, eventCount, engagedSessions

  it('should return 9 metric cards matching METRIC_DEFINITIONS order', () => {
    const data = makeGaResponse([
      '1000', '200', '1500', '0.35', '120',
      '2.5', '3000', '5000', '800',
    ]);
    const cards = buildMetricCards(data);

    expect(cards).toHaveLength(9);
    expect(cards.map((c) => c.title)).toEqual([
      'Users', 'New Users', 'Sessions',
      'Bounce Rate', 'Avg. Duration', 'Pages/Session',
      'Pageviews', 'Event Count', 'Engaged Sessions',
    ]);
  });

  it('should format Users as a comma-separated integer', () => {
    const data = makeGaResponse([
      '12345', '0', '0', '0', '0', '0', '0', '0', '0',
    ]);
    const cards = buildMetricCards(data);
    expect(cards[0].value).toBe('12,345');
  });

  it('should format bounceRate as a percentage (×100)', () => {
    const data = makeGaResponse([
      '0', '0', '0', '0.427', '0', '0', '0', '0', '0',
    ]);
    const cards = buildMetricCards(data);
    expect(cards[3].title).toBe('Bounce Rate');
    expect(cards[3].value).toBe('42.7%');
  });

  it('should format averageSessionDuration as minutes and seconds', () => {
    const data = makeGaResponse([
      '0', '0', '0', '0', '185', '0', '0', '0', '0',
    ]);
    const cards = buildMetricCards(data);
    expect(cards[4].title).toBe('Avg. Duration');
    expect(cards[4].value).toBe('3m 5s');
  });

  it('should format averageSessionDuration as hours and minutes for long durations', () => {
    const data = makeGaResponse([
      '0', '0', '0', '0', '7320', '0', '0', '0', '0',
    ]);
    const cards = buildMetricCards(data);
    expect(cards[4].value).toBe('2h 2m');
  });

  it('should format screenPageViewsPerSession as X.X', () => {
    const data = makeGaResponse([
      '0', '0', '0', '0', '0', '3.14159', '0', '0', '0',
    ]);
    const cards = buildMetricCards(data);
    expect(cards[5].title).toBe('Pages/Session');
    expect(cards[5].value).toBe('3.1');
  });

  it('should format eventCount as a comma-separated integer', () => {
    const data = makeGaResponse([
      '0', '0', '0', '0', '0', '0', '0', '99999', '0',
    ]);
    const cards = buildMetricCards(data);
    expect(cards[7].title).toBe('Event Count');
    expect(cards[7].value).toBe('99,999');
  });

  it('should format engagedSessions as a comma-separated integer', () => {
    const data = makeGaResponse([
      '0', '0', '0', '0', '0', '0', '0', '0', '4200',
    ]);
    const cards = buildMetricCards(data);
    expect(cards[8].title).toBe('Engaged Sessions');
    expect(cards[8].value).toBe('4,200');
  });

  // ── Change / comparison tests ──

  it('should calculate positive change for increasing sessions', () => {
    const data = makeGaResponse(
      ['0', '0', '200', '0', '0', '0', '0', '0', '0'],
      ['0', '0', '100', '0', '0', '0', '0', '0', '0'],
    );
    const cards = buildMetricCards(data);
    expect(cards[2].change).toBe('+100.0%');
    expect(cards[2].changeType).toBe('positive');
  });

  it('should calculate negative change for decreasing users', () => {
    const data = makeGaResponse(
      ['50', '0', '0', '0', '0', '0', '0', '0', '0'],
      ['100', '0', '0', '0', '0', '0', '0', '0', '0'],
    );
    const cards = buildMetricCards(data);
    expect(cards[0].change).toBe('-50.0%');
    expect(cards[0].changeType).toBe('negative');
  });

  it('should treat bounce rate decrease as positive (good)', () => {
    // bounceRate went from 0.5 → 0.3 — that's a decrease which is good
    const data = makeGaResponse(
      ['0', '0', '0', '0.3', '0', '0', '0', '0', '0'],
      ['0', '0', '0', '0.5', '0', '0', '0', '0', '0'],
    );
    const cards = buildMetricCards(data);
    expect(cards[3].changeType).toBe('positive'); // decrease in bounce is good
    expect(cards[3].change).toBe('-20.0%');
  });

  it('should treat bounce rate increase as negative (bad)', () => {
    const data = makeGaResponse(
      ['0', '0', '0', '0.6', '0', '0', '0', '0', '0'],
      ['0', '0', '0', '0.4', '0', '0', '0', '0', '0'],
    );
    const cards = buildMetricCards(data);
    expect(cards[3].changeType).toBe('negative');
    expect(cards[3].change).toBe('+20.0%');
  });

  it('should return empty change when no previous period data', () => {
    const data = makeGaResponse([
      '100', '20', '150', '0.35', '120', '2.5', '300', '500', '80',
    ]);
    const cards = buildMetricCards(data);
    cards.forEach((card) => {
      expect(card.change).toBe('');
    });
  });

  it('should return empty metrics array for no rows', () => {
    const cards = buildMetricCards({ rows: [] });
    expect(cards).toHaveLength(9);
    cards.forEach((card) => {
      expect(card.value).toBe('0');
    });
  });

  it('should return empty metrics for undefined rows', () => {
    const cards = buildMetricCards({});
    expect(cards).toHaveLength(9);
    cards.forEach((card) => {
      expect(card.value).toBe('0');
    });
  });
});
