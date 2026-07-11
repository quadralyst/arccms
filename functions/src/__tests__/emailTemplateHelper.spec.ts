import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmailTemplate, createOtpEmailLog, createWelcomeEmailLog } from '../utils/emailTemplateHelper.js';
import { db } from '../init.js';
import { queueEmail } from '../email-core/queueEmail.js';

// Mock init and constant
vi.mock('../init', () => ({
  db: {
    collection: vi.fn(),
  },
}));

vi.mock('../constant', () => ({
  constant: {},
}));

// The create* helpers now delegate to the queueEmail() chokepoint.
vi.mock('../email-core/queueEmail', () => ({
  queueEmail: vi.fn().mockResolvedValue({ id: 'log-1', status: 'pending' }),
}));

describe('emailTemplateHelper', () => {
  const mockDb = db as any;
  const mockQueueEmail = vi.mocked(queueEmail);

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueEmail.mockResolvedValue({ id: 'log-1', status: 'pending' });
  });

  describe('getEmailTemplate', () => {
    it('should return waitlist-specific template if found', async () => {
      const mockWaitlistData = { template: 'waitlist-template' };
      const waitlistQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({
          empty: false,
          docs: [{ data: () => mockWaitlistData }],
        }),
      };

      mockDb.collection.mockReturnValue(waitlistQuery);

      const result = await getEmailTemplate('wl-123', 'waitlist_verify_otp_email');
      expect(result).toEqual(mockWaitlistData);
      expect(mockDb.collection).toHaveBeenCalledWith('EmailTemplate');
    });

    it('should fallback to config template if waitlist template not found', async () => {
      const mockConfigData = { template: 'config-template' };

      // First query returns empty (waitlist specific)
      // Second query returns data (config fallback)
      const emptyQuery = {
        empty: true,
        docs: [],
      };

      const configQuery = {
        empty: false,
        docs: [{ data: () => mockConfigData }],
      };

      const queryChain = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn()
          .mockResolvedValueOnce(emptyQuery) // Waitlist specific
          .mockResolvedValueOnce(configQuery), // Global config
      };

      mockDb.collection.mockReturnValue(queryChain);

      const result = await getEmailTemplate('wl-123', 'waitlist_verify_otp_email');
      expect(result).toEqual(mockConfigData);
    });

    it('should throw error if no template found', async () => {
      const emptyQuery = {
        empty: true,
        docs: [],
      };

      const queryChain = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(emptyQuery),
      };

      mockDb.collection.mockReturnValue(queryChain);

      await expect(getEmailTemplate('wl-123', 'waitlist_verify_otp_email'))
        .rejects.toThrow('No email template found for type: waitlist_verify_otp_email');
    });
  });

  describe('createOtpEmailLog', () => {
    it('should queue a transactional waitlist OTP email', async () => {
      const userData = {
        email: 'test@user.com',
        verificationCode: '123456',
        waitlistId: 'wl-123',
      };
      const templateData = {
        senderEmail: 'sender@test.com',
        senderName: 'Sender',
        subject: 'Subject',
        template: '<h1>OTP</h1>',
        type: 'waitlist_verify_otp_email',
      };

      await createOtpEmailLog(userData as any, templateData as any);

      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
        source: 'waitlist',
        category: 'transactional',
        toEmail: 'test@user.com',
        subject: 'Subject',
        type: 'waitlist_verify_otp_email',
        // No firstName/name → falls back to email prefix
        toName: 'test',
        data: expect.objectContaining({ otp: '123456' }),
      }));
    });

    it('should use firstName when available (not email prefix)', async () => {
      const userData = {
        email: 'gunjan+test1@example.com',
        firstName: 'Gunjan Karun',
        verificationCode: '999999',
        waitlistId: 'wl-abc',
      };
      const templateData = {
        senderEmail: 's@s.com', senderName: 'S', subject: 'OTP', template: '<p>##NAME##</p>', type: 'waitlist_verify_otp_email',
      };

      await createOtpEmailLog(userData as any, templateData as any);

      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
        toName: 'Gunjan Karun',
      }));
    });

    it('should fall back to name field when firstName is absent', async () => {
      const userData = {
        email: 'gunjan+test1@example.com',
        name: 'Full Name',
        verificationCode: '111111',
        waitlistId: 'wl-abc',
      };
      const templateData = {
        senderEmail: 's@s.com', senderName: 'S', subject: 'OTP', template: '<p>##NAME##</p>', type: 'waitlist_verify_otp_email',
      };

      await createOtpEmailLog(userData as any, templateData as any);

      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
        toName: 'Full Name',
      }));
    });

    it('should fall back to email prefix when both firstName and name are absent', async () => {
      const userData = {
        email: 'gunjan+test1@example.com',
        verificationCode: '222222',
        waitlistId: 'wl-abc',
      };
      const templateData = {
        senderEmail: 's@s.com', senderName: 'S', subject: 'OTP', template: '<p>##NAME##</p>', type: 'waitlist_verify_otp_email',
      };

      await createOtpEmailLog(userData as any, templateData as any);

      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
        toName: 'gunjan+test1',
      }));
    });

    it('should pass templateIsActive=false through to queueEmail', async () => {
      await createOtpEmailLog(
        { email: 'a@b.com', verificationCode: '1', waitlistId: 'w' } as any,
        { senderEmail: 's', senderName: 'S', subject: 'x', template: 'y', type: 'waitlist_verify_otp_email', isActive: false } as any,
      );
      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ templateIsActive: false }));
    });
  });

  describe('createWelcomeEmailLog', () => {
    it('should queue a marketing waitlist welcome email', async () => {
      const userData = {
        email: 'test@user.com',
        firstName: 'Tester',
        waitlistId: 'wl-123',
        referralLink: 'ref-link',
      };
      const templateData = {
        senderEmail: 'sender@test.com',
        senderName: 'Sender',
        subject: 'Welcome',
        template: '<h1>Welcome</h1>',
        type: 'waitlist_welcome_email',
      };

      await createWelcomeEmailLog(userData as any, templateData as any, 'My Waitlist');

      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
        source: 'waitlist',
        category: 'marketing',
        toEmail: 'test@user.com',
        toName: 'Tester',
        subject: 'Welcome',
        // default: subscribed unless explicitly false
        isSubscribed: true,
        data: expect.objectContaining({
          waitlistName: 'My Waitlist',
          referralLink: 'ref-link',
        }),
      }));
    });

    it('should pass isSubscribed=false when the user has unsubscribed', async () => {
      await createWelcomeEmailLog(
        { email: 'x@y.com', isSubscribed: false, waitlistId: 'w' } as any,
        { senderEmail: 's', senderName: 'S', subject: 'W', template: 'T', type: 'waitlist_welcome_email' } as any,
      );
      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ isSubscribed: false }));
    });
  });
});
