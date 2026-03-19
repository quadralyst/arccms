import { describe, it, expect } from 'vitest';
import { constant } from '../constant.js';

describe('constant (functions/src/constant.ts)', () => {
  describe('Security-sensitive defaults', () => {
    it('should have TRACKING_PIXEL_URL defaulting to empty string', () => {
      expect(constant.TRACKING_PIXEL_URL).toBe('');
    });

    it('should have live_url defaulting to empty string (requires manual configuration)', () => {
      expect(constant.live_url).toBe('');
    });

    it('should NOT contain any hardcoded analytics property IDs', () => {
      expect(constant).not.toHaveProperty('ANALYTICS_PROPERTY_ID');
    });

    it('should NOT contain any hardcoded email addresses', () => {
      expect(constant).not.toHaveProperty('adminEmail');
      expect(constant).not.toHaveProperty('userEmail');
      expect(constant).not.toHaveProperty('testingSenderEmail');
    });

    it('should NOT contain any hardcoded API keys', () => {
      expect(constant).not.toHaveProperty('MSG91_AuthKey');
      expect(constant).not.toHaveProperty('MSG91_UserName');
      expect(constant).not.toHaveProperty('MSG91_Password');
      expect(constant).not.toHaveProperty('MSG91_PHONEBOOK_ID');
      expect(constant).not.toHaveProperty('MSG91_TemplateId');
    });
  });

  describe('Required configuration properties', () => {
    it('should have local_url for development', () => {
      expect(constant.local_url).toBe('http://localhost:5173/');
    });

    it('should have isProduction flag', () => {
      expect(constant).toHaveProperty('isProduction');
      expect(typeof constant.isProduction).toBe('boolean');
    });
  });

  describe('REFERRAL_STATUS', () => {
    it('should have COMPLETED and PENDING statuses', () => {
      expect(constant.REFERRAL_STATUS.COMPLETED).toBe('completed');
      expect(constant.REFERRAL_STATUS.PENDING).toBe('pending');
    });
  });

  describe('Unused constants should not exist', () => {
    it('should not contain unused constants that were removed', () => {
      expect(constant).not.toHaveProperty('defaultEmailTags');
      expect(constant).not.toHaveProperty('PUBLISH');
      expect(constant).not.toHaveProperty('DRAFT');
      expect(constant).not.toHaveProperty('DUPLICATE');
      expect(constant).not.toHaveProperty('NEW');
      expect(constant).not.toHaveProperty('systemInstructionForPrompt');
      expect(constant).not.toHaveProperty('REFINE');
      expect(constant).not.toHaveProperty('FETCH_CONTENT');
      expect(constant).not.toHaveProperty('CRON_JOB_STATUS');
      expect(constant).not.toHaveProperty('EMAIL_SEND_STATUS');
    });
  });
});
