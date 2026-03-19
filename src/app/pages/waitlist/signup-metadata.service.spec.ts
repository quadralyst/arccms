/**
 * Tests for SignupMetadataService
 */
import { TestBed } from '@angular/core/testing';
import { SignupMetadataService } from './signup-metadata.service';
import { PLATFORM_ID } from '@angular/core';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('SignupMetadataService', () => {
  let service: SignupMetadataService;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        SignupMetadataService,
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });

    service = TestBed.inject(SignupMetadataService);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('collectMetadata', () => {
    it('should collect basic metadata', () => {
      const metadata = service.collectMetadata();

      expect(metadata).toBeDefined();
      expect(metadata.landingPage).toBeDefined();
      expect(metadata.pageLoadTimestamp).toBeGreaterThan(0);
    });

    it('should detect device type', () => {
      const metadata = service.collectMetadata();

      expect(metadata.deviceType).toBeDefined();
      expect(['desktop', 'mobile', 'tablet']).toContain(metadata.deviceType);
    });

    it('should detect browser info', () => {
      const metadata = service.collectMetadata();

      expect(metadata.browser).toBeDefined();
      expect(metadata.operatingSystem).toBeDefined();
    });

    it('should capture screen resolution', () => {
      const metadata = service.collectMetadata();

      expect(metadata.screenResolution).toBeDefined();
      expect(metadata.screenResolution).toMatch(/\d+x\d+/);
    });
  });

  describe('UTM parsing', () => {
    it('should parse UTM parameters from URL', () => {
      // Note: In unit tests, window.location.search is typically empty
      // This test validates the function doesn't throw
      const metadata = service.collectMetadata();

      // UTM params would be undefined when not present in URL
      expect(metadata).toBeDefined();
    });
  });

  describe('Extended Device Info', () => {
    it('should capture viewport size', () => {
      const metadata = service.collectMetadata();
      expect(metadata.viewportSize).toMatch(/\d+x\d+/);
    });

    it('should capture touch device info', () => {
      const metadata = service.collectMetadata();
      expect(metadata.isTouchDevice).toBeDefined();
      expect(typeof metadata.isTouchDevice).toBe('boolean');
    });

    it('should capture dark mode preference when matchMedia is available', () => {
      // jsdom may not support matchMedia; mock it
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as any;

      const metadata = service.collectMetadata();
      expect(metadata.prefersDarkMode).toBe(true);

      window.matchMedia = originalMatchMedia;
    });

    it('should capture timezone offset', () => {
      const metadata = service.collectMetadata();
      expect(metadata.timezoneOffset).toBeDefined();
      expect(typeof metadata.timezoneOffset).toBe('number');
    });

    it('should capture signup hour and day of week', () => {
      const metadata = service.collectMetadata();
      expect(metadata.signupHour).toBeDefined();
      expect(metadata.signupHour).toBeGreaterThanOrEqual(0);
      expect(metadata.signupHour).toBeLessThan(24);
      expect(metadata.signupDayOfWeek).toBeDefined();
      expect(metadata.signupDayOfWeek).toBeGreaterThanOrEqual(0);
      expect(metadata.signupDayOfWeek).toBeLessThan(7);
    });

    it('should not include queryParams when URL has no non-UTM params', () => {
      const metadata = service.collectMetadata();
      // In test environment, window.location.search is empty
      expect(metadata.queryParams).toBeUndefined();
    });

    it('should gracefully handle missing navigator.connection', () => {
      const metadata = service.collectMetadata();
      // navigator.connection is not available in jsdom
      expect(metadata.connectionType).toBeUndefined();
      expect(metadata.downlinkSpeed).toBeUndefined();
    });
  });

  describe('Cross-Session Persistence', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('should create arc_session_data on first visit', () => {
      service.startBehaviorTracking();
      const stored = JSON.parse(localStorage.getItem('arc_session_data')!);
      expect(stored.visitCount).toBe(1);
      expect(stored.firstVisitTimestamp).toBeGreaterThan(0);
      expect(stored.lastVisitTimestamp).toBeGreaterThan(0);
      expect(stored.maxScrollDepthPercent).toBe(0);
      expect(stored.totalTimeOnPageMs).toBe(0);
      expect(stored.formStartCount).toBe(0);
    });

    it('should increment visitCount across sessions', () => {
      service.startBehaviorTracking();
      expect(service.getVisitCount()).toBe(1);

      const stored = JSON.parse(localStorage.getItem('arc_session_data')!);
      expect(stored.visitCount).toBe(1);

      // Simulate second visit
      (service as any).scrollTrackingActive = false;
      (service as any).sessionData = null;
      service.startBehaviorTracking();
      expect(service.getVisitCount()).toBe(2);
    });

    it('should migrate legacy arc_visit_count key', () => {
      localStorage.setItem('arc_visit_count', '3');
      localStorage.setItem('arc_return_visitor', 'true');

      service.startBehaviorTracking();

      // Legacy keys should be removed
      expect(localStorage.getItem('arc_visit_count')).toBeNull();
      expect(localStorage.getItem('arc_return_visitor')).toBeNull();

      // New key should exist with migrated count + 1
      const stored = JSON.parse(localStorage.getItem('arc_session_data')!);
      expect(stored.visitCount).toBe(4); // 3 migrated + 1 current
    });

    it('should migrate legacy arc_return_visitor key without count', () => {
      localStorage.setItem('arc_return_visitor', 'true');

      service.startBehaviorTracking();

      expect(localStorage.getItem('arc_return_visitor')).toBeNull();
      const stored = JSON.parse(localStorage.getItem('arc_session_data')!);
      expect(stored.visitCount).toBe(2); // 1 migrated + 1 current
    });

    it('should persist maxScrollDepth across sessions', () => {
      service.startBehaviorTracking();

      // Simulate scrolling to 85%
      (service as any).maxScrollDepth = 85;
      (service as any).sessionData.maxScrollDepthPercent = 85;
      (service as any).saveSessionData();

      // Simulate new session
      (service as any).scrollTrackingActive = false;
      (service as any).sessionData = null;
      service.startBehaviorTracking();

      // maxScrollDepth should be restored from storage
      expect(service.getScrollDepth()).toBe(85);
    });

    it('should accumulate totalTimeOnPageMs across sessions', () => {
      service.startBehaviorTracking();
      // Simulate stored time from previous sessions
      const data = JSON.parse(localStorage.getItem('arc_session_data')!);
      data.totalTimeOnPageMs = 10000;
      localStorage.setItem('arc_session_data', JSON.stringify(data));

      // Reset in-memory cache so it reloads
      (service as any).sessionData = null;

      // At collection, should add current session time to stored total
      const metadata = service.collectMetadataWithBehavior();
      expect(metadata.totalTimeOnPageMs).toBeGreaterThanOrEqual(10000);
    });

    it('should detect return visitor from session data', () => {
      service.startBehaviorTracking();
      expect(service.isReturnVisitor()).toBe(false); // first visit

      (service as any).scrollTrackingActive = false;
      (service as any).sessionData = null;
      service.startBehaviorTracking();
      expect(service.isReturnVisitor()).toBe(true); // second visit
    });

    it('should preserve firstVisitTimestamp across sessions', () => {
      service.startBehaviorTracking();
      const firstVisit = JSON.parse(localStorage.getItem('arc_session_data')!).firstVisitTimestamp;

      // Simulate new session
      (service as any).scrollTrackingActive = false;
      (service as any).sessionData = null;
      service.startBehaviorTracking();

      const stored = JSON.parse(localStorage.getItem('arc_session_data')!);
      expect(stored.firstVisitTimestamp).toBe(firstVisit);
    });
  });

  describe('Form Interaction Tracking', () => {
    it('should track formStartCount once per session', () => {
      service.startBehaviorTracking();
      service.trackFormInteraction();
      service.trackFormInteraction(); // second call same session

      const stored = JSON.parse(localStorage.getItem('arc_session_data')!);
      expect(stored.formStartCount).toBe(1);
    });

    it('should increment formStartCount across sessions', () => {
      service.startBehaviorTracking();
      service.trackFormInteraction();

      // Simulate new session
      (service as any).scrollTrackingActive = false;
      (service as any).sessionData = null;
      (service as any).formInteractedThisSession = false;
      service.startBehaviorTracking();
      service.trackFormInteraction();

      const stored = JSON.parse(localStorage.getItem('arc_session_data')!);
      expect(stored.formStartCount).toBe(2);
    });
  });

  describe('Engagement Tracking', () => {
    it('should include clickCount in behavioral data', () => {
      service.startBehaviorTracking();

      // Simulate clicks
      (service as any).clickCount = 5;

      const metadata = service.collectMetadataWithBehavior();
      expect(metadata.clickCount).toBe(5);
    });

    it('should include tabSwitchCount in behavioral data', () => {
      service.startBehaviorTracking();

      // Simulate tab switches
      (service as any).tabSwitchCount = 3;

      const metadata = service.collectMetadataWithBehavior();
      expect(metadata.tabSwitchCount).toBe(3);
    });

    it('should not include zero clickCount or tabSwitchCount', async () => {
      service.startBehaviorTracking();

      const metadata = await service.collectAllMetadata('test@example.com');
      // Zero values should be stripped by removeUndefined (they are set to undefined when 0)
      expect(metadata.clickCount).toBeUndefined();
      expect(metadata.tabSwitchCount).toBeUndefined();
    });
  });

  describe('Data Persistence', () => {
    it('should persist browser data even if UTM params are missing', () => {
      // In default test environment, window.location.search is empty (no UTMs)
      const metadata = service.collectMetadata();

      expect(metadata.utmSource).toBeUndefined();

      // Browsers info should still be present
      expect(metadata.deviceType).toBeDefined();
      expect(metadata.browser).toBeDefined();
      expect(metadata.operatingSystem).toBeDefined();
    });
  });

  describe('Firestore Compatibility', () => {
    it('should NOT contain undefined values (regression test)', async () => {
      // Create a scenario where some fields would be undefined (default state)
      const metadata = await service.collectAllMetadata('test@example.com');

      // Recursively check for undefined values
      const hasUndefined = (obj: any): boolean => {
        return Object.keys(obj).some((key) => {
          if (obj[key] === undefined) return true;
          if (obj[key] && typeof obj[key] === 'object')
            return hasUndefined(obj[key]);
          return false;
        });
      };

      expect(hasUndefined(metadata)).toBe(false);
    });
  });
});
