import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmailTemplate, createOtpEmailLog, createWelcomeEmailLog } from '../utils/emailTemplateHelper.js';
import { db } from '../init.js';

// Mock init and constant
vi.mock('../init', () => ({
  db: {
    collection: vi.fn(),
  },
}));

vi.mock('../constant', () => ({
  constant: {},
}));

describe('emailTemplateHelper', () => {
  const mockDb = db as any;

  beforeEach(() => {
    vi.clearAllMocks();
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
    it('should create correct email log', async () => {
      const mockAdd = vi.fn();
      const mockSettingsGet = vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ bccEmail: 'admin@test.com' }),
      });

      const mockCollection = vi.fn((name) => {
        if (name === 'Settings') return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
        if (name === 'EmailLogs') return { add: mockAdd };
        return { doc: vi.fn() };
      });

      mockDb.collection = mockCollection;

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

      expect(mockCollection).toHaveBeenCalledWith('Settings');
      expect(mockCollection).toHaveBeenCalledWith('EmailLogs');
      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
        toEmail: 'test@user.com',
        otp: '123456',
        subject: 'Subject',
        bcc: 'admin@test.com',
        // No firstName/name → falls back to email prefix
        toName: 'test',
        name: 'test',
      }));
    });

    it('should use firstName when available (not email prefix)', async () => {
      const mockAdd = vi.fn();
      const mockSettingsGet = vi.fn().mockResolvedValue({ exists: false, data: () => ({}) });
      const mockCollection = vi.fn((name) => {
        if (name === 'Settings') return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
        if (name === 'EmailLogs') return { add: mockAdd };
        return { doc: vi.fn() };
      });
      mockDb.collection = mockCollection;

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

      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
        toName: 'Gunjan Karun',
        name: 'Gunjan Karun',
      }));
    });

    it('should fall back to name field when firstName is absent', async () => {
      const mockAdd = vi.fn();
      const mockSettingsGet = vi.fn().mockResolvedValue({ exists: false, data: () => ({}) });
      const mockCollection = vi.fn((name) => {
        if (name === 'Settings') return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
        if (name === 'EmailLogs') return { add: mockAdd };
        return { doc: vi.fn() };
      });
      mockDb.collection = mockCollection;

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

      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
        toName: 'Full Name',
        name: 'Full Name',
      }));
    });

    it('should fall back to email prefix when both firstName and name are absent', async () => {
      const mockAdd = vi.fn();
      const mockSettingsGet = vi.fn().mockResolvedValue({ exists: false, data: () => ({}) });
      const mockCollection = vi.fn((name) => {
        if (name === 'Settings') return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
        if (name === 'EmailLogs') return { add: mockAdd };
        return { doc: vi.fn() };
      });
      mockDb.collection = mockCollection;

      const userData = {
        email: 'gunjan+test1@example.com',
        verificationCode: '222222',
        waitlistId: 'wl-abc',
      };
      const templateData = {
        senderEmail: 's@s.com', senderName: 'S', subject: 'OTP', template: '<p>##NAME##</p>', type: 'waitlist_verify_otp_email',
      };

      await createOtpEmailLog(userData as any, templateData as any);

      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
        toName: 'gunjan+test1',
        name: 'gunjan+test1',
      }));
    });
  });

  describe('createWelcomeEmailLog', () => {
    it('should create correct welcome email log', async () => {
      const mockAdd = vi.fn();
      const mockSettingsGet = vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ bccEmail: 'admin@test.com' }),
      });

      const mockCollection = vi.fn((name) => {
        if (name === 'Settings') return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
        if (name === 'EmailLogs') return { add: mockAdd };
        return { doc: vi.fn() };
      });

      mockDb.collection = mockCollection;

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

      expect(mockCollection).toHaveBeenCalledWith('Settings');
      expect(mockCollection).toHaveBeenCalledWith('EmailLogs');
      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
        toEmail: 'test@user.com',
        toName: 'Tester',
        subject: 'Welcome',
        waitlistName: 'My Waitlist',
        referralLink: 'ref-link'
      }));
    });
  });
});
