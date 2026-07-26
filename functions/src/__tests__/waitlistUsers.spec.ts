import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mockGetEmailTemplate = vi.fn();
const mockCreateWelcomeEmailLog = vi.fn();
const mockCreateOtpEmailLog = vi.fn();
const mockGet = vi.fn();

vi.mock('../init', () => ({
  db: {
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: mockGet,
      }),
    }),
    doc: vi.fn().mockReturnThis(),
    batch: vi.fn(() => ({
      set: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

vi.mock('../utils/emailTemplateHelper', () => ({
  getEmailTemplate: (...args: any[]) => mockGetEmailTemplate(...args),
  createWelcomeEmailLog: (...args: any[]) => mockCreateWelcomeEmailLog(...args),
  createOtpEmailLog: (...args: any[]) => mockCreateOtpEmailLog(...args),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((path, handler) => handler),
  onDocumentUpdated: vi.fn((path, handler) => handler),
}));

describe('Waitlist User Functions', () => {
  describe('onWaitlistUserCreate', () => {
    it('should use shared emailTemplateHelper', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/waitlist-details/onWaitlistUserCreate.ts'),
        'utf-8'
      );

      // OTP email removed from this function — it's handled by onWaitlistedUsersCreate only
      expect(fileContent).toContain("import { getEmailTemplate, createWelcomeEmailLog }");
    });

    it('should use v2 API', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/waitlist-details/onWaitlistUserCreate.ts'),
        'utf-8'
      );

      expect(fileContent).toContain("from 'firebase-functions/v2/firestore'");
    });
  });

  describe('onWaitlistUserUpdate', () => {
    it('should use shared emailTemplateHelper', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/waitlist-details/onWaitlistUserUpdate.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('getEmailTemplate');
    });

    it('should handle both welcome email and OTP email for returning users', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/waitlist-details/onWaitlistUserUpdate.ts'),
        'utf-8'
      );

      // Welcome email: sent when emailVerified flips to true
      expect(fileContent).toContain('createWelcomeEmailLog');
      expect(fileContent).toContain('emailVerified');
      // OTP email: sent when verificationCode changes for a returning verified user
      expect(fileContent).toContain('createOtpEmailLog');
      expect(fileContent).toContain('verificationCodeChanged');
    });

    // ── Behavioral tests ──────────────────────────────────────

    describe('handler behavior', () => {
      let handler: (event: any) => Promise<void>;

      beforeEach(async () => {
        vi.clearAllMocks();
        // The mock for onDocumentUpdated returns the handler directly
        const mod = await import('../waitlists/waitlist-details/onWaitlistUserUpdate.js');
        handler = mod.onWaitlistUserUpdate as unknown as (event: any) => Promise<void>;

        mockGetEmailTemplate.mockResolvedValue({
          senderEmail: 'noreply@test.com',
          senderName: 'Test',
          subject: 'Welcome!',
          template: '<p>Welcome</p>',
          type: 'waitlist_welcome_email',
        });
        mockCreateWelcomeEmailLog.mockResolvedValue(undefined);
        mockCreateOtpEmailLog.mockResolvedValue(undefined);
        mockGet.mockResolvedValue({ exists: true, data: () => ({ name: 'My Waitlist' }) });
      });

      function makeEvent(oldData: any, newData: any) {
        return {
          data: {
            before: { data: () => oldData },
            after: { data: () => newData },
          },
        };
      }

      it('should return early when event data is missing', async () => {
        await handler({ data: { before: { data: () => undefined }, after: { data: () => undefined } } });
        expect(mockGetEmailTemplate).not.toHaveBeenCalled();
      });

      // ── Welcome email tests ──

      it('should send welcome email when emailVerified changes from false to true', async () => {
        const event = makeEvent(
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: false },
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true },
        );
        await handler(event);

        expect(mockGetEmailTemplate).toHaveBeenCalledWith('wl1', 'waitlist_welcome_email');
        expect(mockCreateWelcomeEmailLog).toHaveBeenCalledWith(
          expect.objectContaining({ email: 'user@test.com', emailVerified: true }),
          expect.any(Object),
          'My Waitlist',
        );
      });

      it('should NOT send welcome email when emailVerified did not change', async () => {
        const event = makeEvent(
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true },
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true },
        );
        await handler(event);

        expect(mockCreateWelcomeEmailLog).not.toHaveBeenCalled();
      });

      it('should NOT send welcome email when emailVerified changes to false', async () => {
        const event = makeEvent(
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true },
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: false },
        );
        await handler(event);

        expect(mockCreateWelcomeEmailLog).not.toHaveBeenCalled();
      });

      it('should use empty waitlist name when waitlist doc does not exist', async () => {
        mockGet.mockResolvedValue({ exists: false, data: () => undefined });

        const event = makeEvent(
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: false },
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true },
        );
        await handler(event);

        expect(mockCreateWelcomeEmailLog).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(Object),
          '',
        );
      });

      it('should not throw when welcome email template fetch rejects', async () => {
        mockGetEmailTemplate.mockRejectedValue(new Error('Template not found'));

        const event = makeEvent(
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: false },
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true },
        );

        await expect(handler(event)).resolves.toBeUndefined();
        expect(mockCreateWelcomeEmailLog).not.toHaveBeenCalled();
      });

      // ── OTP email tests (returning verified user re-signup flow) ──

      it('should send OTP email when verificationCode changes for a verified user', async () => {
        const event = makeEvent(
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true, verificationCode: 'old123' },
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true, verificationCode: 'new456' },
        );
        await handler(event);

        expect(mockGetEmailTemplate).toHaveBeenCalledWith('wl1', 'waitlist_verify_otp_email');
        expect(mockCreateOtpEmailLog).toHaveBeenCalledWith(
          expect.objectContaining({ email: 'user@test.com', verificationCode: 'new456' }),
          expect.any(Object),
        );
      });

      it('should NOT send OTP email when verificationCode changes for an unverified user', async () => {
        const event = makeEvent(
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: false, verificationCode: 'old123' },
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: false, verificationCode: 'new456' },
        );
        await handler(event);

        expect(mockCreateOtpEmailLog).not.toHaveBeenCalled();
      });

      it('should NOT send OTP email when verificationCode did not change', async () => {
        const event = makeEvent(
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true, verificationCode: 'same123' },
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true, verificationCode: 'same123' },
        );
        await handler(event);

        expect(mockCreateOtpEmailLog).not.toHaveBeenCalled();
      });

      it('should NOT send OTP email when verificationCode is cleared to empty string', async () => {
        const event = makeEvent(
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true, verificationCode: 'old123' },
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true, verificationCode: '' },
        );
        await handler(event);

        expect(mockCreateOtpEmailLog).not.toHaveBeenCalled();
      });

      it('should not throw when OTP email template fetch rejects', async () => {
        // First call (welcome) succeeds, second call (OTP) rejects
        mockGetEmailTemplate
          .mockResolvedValueOnce({ senderEmail: 'x', senderName: 'x', subject: 'x', template: 'x', type: 'x' })
          .mockRejectedValueOnce(new Error('OTP template not found'));

        const event = makeEvent(
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: false, verificationCode: 'old' },
          { email: 'user@test.com', waitlistId: 'wl1', emailVerified: true, verificationCode: 'new' },
        );

        // Both welcome + OTP paths fire; OTP error is caught internally
        await expect(handler(event)).resolves.toBeUndefined();
        // Welcome email should still have been sent
        expect(mockCreateWelcomeEmailLog).toHaveBeenCalled();
        // OTP email should not have been sent (template fetch failed)
        expect(mockCreateOtpEmailLog).not.toHaveBeenCalled();
      });
    });
  });

  describe('the retired WaitlistedUsers triggers (U6 cutover)', () => {
    it('no longer exist', async () => {
      // onWaitlistedUsersCreate / onWaitlistedUserUpdate emailed an OTP when
      // `verificationCode` was written to a registry doc. U5 stopped writing that field
      // — requestFormOtp sends the code directly — so both had been dormant since, and
      // joinForm no longer creates registry docs at all. Asserting their absence keeps a
      // future change from resurrecting a path that would email from frozen data.
      const fs = await import('fs');
      const path = await import('path');

      expect(fs.existsSync(path.resolve(__dirname, '../waitlists/waitlistedUsers'))).toBe(false);
    });

    it('are not exported from the functions entrypoint', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const index = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf-8');

      expect(index).not.toContain("export * from './waitlists/waitlistedUsers/");
    });
  });
});

describe('Waitlist Create Function', () => {
  describe('onWaitlistsCreate', () => {
    it('should use v2 API', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/onWaitlistsCreate.ts'),
        'utf-8'
      );

      expect(fileContent).toContain("from 'firebase-functions/v2/firestore'");
    });

    it('should create email templates on waitlist creation', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/onWaitlistsCreate.ts'),
        'utf-8'
      );

      // U5.5: the trigger is only the *eager* path now — it delegates to the same
      // helper that every send path calls lazily, so a form whose trigger never
      // fired still gets its templates the first time one is needed. The trigger
      // must therefore hold no seeding logic of its own.
      expect(fileContent).toContain('ensureWaitlistTemplates');
      expect(fileContent).not.toContain("collection('EmailTemplate')");
      expect(fileContent).not.toContain('buildWaitlistTemplateDefs');

      const defaults = fs.readFileSync(
        path.resolve(__dirname, '../email-core/defaultTemplates.ts'),
        'utf-8'
      );
      expect(defaults).toContain('waitlist_welcome_email');
      expect(defaults).toContain('waitlist_verify_otp_email');
      expect(defaults).toContain("collection('EmailTemplate')");
    });

    it('should create the mirrored audience list eagerly', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/onWaitlistsCreate.ts'),
        'utf-8'
      );

      // A form must appear under Audience → Lists before its first signup (U1).
      expect(fileContent).toContain('ensureFormList');
    });
  });
});
