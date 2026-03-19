import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import fs from 'node:fs';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Regression tests: all three analytics lifecycle functions must delete
 * the cached AnalyticsDashboards/analyticsData document so stale metrics
 * from a previously-connected property are never shown on the dashboard.
 */

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf-8');
}

describe('Analytics data clearing on property change', () => {
  describe('connectGoogleAnalytics', () => {
    const src = readSource('../AnalyticsDashboard/connectGoogleAnalytics.ts');

    it('should delete AnalyticsDashboards/analyticsData before fetching new data', () => {
      expect(src).toContain("collection('AnalyticsDashboards').doc('analyticsData').delete()");
    });

    it('should delete stale data before calling fetchAndStoreAnalyticsData', () => {
      const deleteIndex = src.indexOf("collection('AnalyticsDashboards').doc('analyticsData').delete()");
      // Skip the import statement — find the actual call site with db argument
      const fetchIndex = src.indexOf('fetchAndStoreAnalyticsData(db');
      expect(deleteIndex).toBeGreaterThan(-1);
      expect(fetchIndex).toBeGreaterThan(-1);
      expect(deleteIndex).toBeLessThan(fetchIndex);
    });

    it('should wrap the delete in a try/catch (non-fatal)', () => {
      // Extract the region around the delete call and verify it's inside a try block
      const deleteIndex = src.indexOf("collection('AnalyticsDashboards').doc('analyticsData').delete()");
      const preceding = src.slice(Math.max(0, deleteIndex - 200), deleteIndex);
      expect(preceding).toContain('try');
    });
  });

  describe('selectAnalyticsProperty', () => {
    const src = readSource('../AnalyticsDashboard/selectAnalyticsProperty.ts');

    it('should delete AnalyticsDashboards/analyticsData before fetching new data', () => {
      expect(src).toContain("collection('AnalyticsDashboards').doc('analyticsData').delete()");
    });

    it('should delete stale data before calling fetchAndStoreAnalyticsData', () => {
      const deleteIndex = src.indexOf("collection('AnalyticsDashboards').doc('analyticsData').delete()");
      const fetchIndex = src.indexOf('fetchAndStoreAnalyticsData(db');
      expect(deleteIndex).toBeGreaterThan(-1);
      expect(fetchIndex).toBeGreaterThan(-1);
      expect(deleteIndex).toBeLessThan(fetchIndex);
    });

    it('should wrap the delete in a try/catch (non-fatal)', () => {
      const deleteIndex = src.indexOf("collection('AnalyticsDashboards').doc('analyticsData').delete()");
      const preceding = src.slice(Math.max(0, deleteIndex - 200), deleteIndex);
      expect(preceding).toContain('try');
    });
  });

  describe('disconnectGoogleAnalytics', () => {
    const src = readSource('../AnalyticsDashboard/disconnectGoogleAnalytics.ts');

    it('should delete AnalyticsDashboards/analyticsData on disconnect', () => {
      expect(src).toContain("collection('AnalyticsDashboards').doc('analyticsData').delete()");
    });

    it('should wrap the delete in a try/catch (non-fatal)', () => {
      const deleteIndex = src.indexOf("collection('AnalyticsDashboards').doc('analyticsData').delete()");
      const preceding = src.slice(Math.max(0, deleteIndex - 200), deleteIndex);
      expect(preceding).toContain('try');
    });
  });
});
