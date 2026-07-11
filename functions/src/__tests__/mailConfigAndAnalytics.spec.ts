import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((opts, handler) => handler),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    get: vi.fn(),
  },
}));

describe('buildTrackingPixel (mailConfig.ts)', () => {
  it('should have a buildTrackingPixel function', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    expect(fileContent).toContain('function buildTrackingPixel');
  });

  it('should return empty string when TRACKING_PIXEL_URL is not configured', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    // The function checks if TRACKING_PIXEL_URL is falsy and returns ''
    expect(fileContent).toContain("if (!constant.TRACKING_PIXEL_URL) return '';");
  });

  it('should build a 1x1 invisible tracking pixel img tag', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    expect(fileContent).toContain('width="1"');
    expect(fileContent).toContain('height="1"');
    expect(fileContent).toContain('opacity:0');
  });

  it('should include emailId as a URL query parameter', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    expect(fileContent).toContain('?emailId=${emailId}');
  });

  it('should use TRACKING_PIXEL_URL from constants (not hardcoded URL)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    // Must use constant, not hardcoded tracking URL
    expect(fileContent).toContain('constant.TRACKING_PIXEL_URL');
    expect(fileContent).not.toContain('trackemailopen-4urd2w5siq');
  });

  it('should be called in all 3 email provider functions', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    // Count occurrences of buildTrackingPixel in the send functions (excluding the function definition itself)
    const callMatches = fileContent.match(/buildTrackingPixel\(emailLogsData\.id\b/g);
    // 3 calls: sendSmtpMail, sendResendMail, sendGmailMail
    expect(callMatches).not.toBeNull();
    expect(callMatches!.length).toBe(3);
  });
});

describe('sendMail — powered-by branding', () => {
  it('should import getMiscSettings from site-settings', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );
    expect(fileContent).toContain("import { getMiscSettings } from '../shared/site-settings.js'");
  });

  it('should import POWERED_BY_EMAIL_HTML from html-document', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );
    expect(fileContent).toContain('POWERED_BY_EMAIL_HTML');
  });

  it('should conditionally append branding based on showPoweredBy', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );
    expect(fileContent).toContain('miscSettings.showPoweredBy');
    expect(fileContent).toContain('POWERED_BY_EMAIL_HTML');
  });

  it('should wrap branding logic in try/catch (non-fatal)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );
    expect(fileContent).toContain('Failed to check showPoweredBy setting');
  });
});

describe('POWERED_BY_EMAIL_HTML (html-document.ts)', () => {
  it('should export an email-specific powered-by constant', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../shared/html-document.ts'),
      'utf-8'
    );
    expect(fileContent).toContain('export const POWERED_BY_EMAIL_HTML');
  });

  it('should use table layout for email compatibility', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../shared/html-document.ts'),
      'utf-8'
    );
    const match = fileContent.match(/POWERED_BY_EMAIL_HTML\s*=\s*`([^`]+)`/);
    expect(match).not.toBeNull();
    const html = match![1];
    expect(html).toContain('<table');
    expect(html).toContain('role="presentation"');
  });

  it('should link to arccms.com with Powered by Arc CMS text', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../shared/html-document.ts'),
      'utf-8'
    );
    const match = fileContent.match(/POWERED_BY_EMAIL_HTML\s*=\s*`([^`]+)`/);
    expect(match).not.toBeNull();
    const html = match![1];
    expect(html).toContain('arccms.com');
    expect(html).toContain('Powered by Arc CMS');
  });
});

describe('sendMail — email counter integration', () => {
  it('should import incrementSendCount from emailCounter', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );
    // Import now also pulls in quota helpers for universal rate-limit enforcement.
    expect(fileContent).toMatch(/import \{[^}]*incrementSendCount[^}]*\} from '\.\/emailCounter\.js'/);
  });

  it('should call incrementSendCount after successful email send', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );
    expect(fileContent).toContain('await incrementSendCount(activeProvider)');
  });

  it('should wrap counter increment in try/catch (non-fatal)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );
    // The counter increment should be in its own try/catch to be non-fatal
    expect(fileContent).toContain('Failed to increment email counter');
  });
});

describe('mailConfig.ts — code hygiene', () => {
  it('should not contain commented-out console.log statements', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    expect(fileContent).not.toMatch(/\/\/\s*console\.log/);
  });

  it('should not contain commented-out BCC assignments', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    expect(fileContent).not.toMatch(/\/\/\s*mailOptions\.bcc/);
  });

  it('should include bcc in mail options', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    // BCC must be included in mail options (either inline or assigned)
    expect(fileContent).toMatch(/bcc:\s*emailLogsData\.bcc/);
  });

  it('should have timeouts on all external fetch calls', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    const fetchCount = (fileContent.match(/await fetch\(/g) || []).length;
    const timeoutCount = (fileContent.match(/AbortSignal\.timeout\(/g) || []).length;
    expect(fetchCount).toBeGreaterThan(0);
    expect(timeoutCount).toBe(fetchCount);
  });
});

describe('testProviderConnection — code hygiene', () => {
  it('should have timeouts on all external fetch calls', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/testProviderConnection.ts'),
      'utf-8'
    );

    const fetchCount = (fileContent.match(/await fetch\(/g) || []).length;
    const timeoutCount = (fileContent.match(/AbortSignal\.timeout\(/g) || []).length;
    expect(fetchCount).toBeGreaterThan(0);
    expect(timeoutCount).toBe(fetchCount);
  });

  it('should not log response data to console', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/testProviderConnection.ts'),
      'utf-8'
    );

    expect(fileContent).not.toMatch(/console\.log\(.*[Rr]esponse/);
  });
});

describe('Type safety — mailConfig.ts', () => {
  it('should not use bare "any" in function parameters', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    // Function params should use proper types, not bare "any"
    expect(fileContent).not.toMatch(/function\s+\w+\([^)]*:\s*any[\s,)]/);
    expect(fileContent).not.toMatch(/async function\s+\w+\([^)]*:\s*any[\s,)]/);
  });

  it('should import typed interfaces from types.ts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );

    expect(fileContent).toContain("from '../types.js'");
    expect(fileContent).toContain('EmailLogData');
    expect(fileContent).toContain('EmailSettings');
    expect(fileContent).toContain('ProcessedTemplate');
  });

  it('should use typed catch blocks (error: unknown)', async () => {
    const fs = await import('fs');
    const path = await import('path');

    for (const file of ['testProviderConnection.ts', 'testSmtpConfigConnection.ts']) {
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, `../mail-config/${file}`),
        'utf-8'
      );
      // Should not have catch (error: any)
      expect(fileContent).not.toMatch(/catch\s*\(\w+:\s*any\)/);
    }
  });
});

describe('Type safety — testProviderConnection.ts', () => {
  it('should use typed config parameters', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/testProviderConnection.ts'),
      'utf-8'
    );

    expect(fileContent).toContain('SmtpConfig');
    expect(fileContent).toContain('GmailConfig');
    expect(fileContent).toContain('ResendConfig');
  });
});

describe('Type safety — testAnalyticsConnection.ts', () => {
  it('should not use onCall<any> or (request: any)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../AnalyticsDashboard/testAnalyticsConnection.ts'),
      'utf-8'
    );

    expect(fileContent).not.toContain('onCall<any>');
    expect(fileContent).not.toMatch(/\(authClient as any\)/);
    expect(fileContent).not.toMatch(/catch\s*\(\w+:\s*any\)/);
  });
});

describe('Type safety — getLeaderBoardData.ts', () => {
  it('should not use (request: any) or catch (error: any)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../waitlists/leaderboard/getLeaderBoardData.ts'),
      'utf-8'
    );

    expect(fileContent).not.toMatch(/request:\s*any/);
    expect(fileContent).not.toMatch(/catch\s*\(\w+:\s*any\)/);
  });

  it('should pass a string message to HttpsError, not a raw error object', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../waitlists/leaderboard/getLeaderBoardData.ts'),
      'utf-8'
    );

    // Should NOT pass raw error: throw new HttpsError('internal', error)
    expect(fileContent).not.toMatch(/HttpsError\('internal',\s*error\)/);
  });
});

describe('processEmailTemplate (##NAME## tag)', () => {
  it('should have NAME mapped in defaultMappings (not just RECEIVER_NAME)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, '../mail-config/mailConfig.ts'),
      'utf-8'
    );
    // NAME alias must be explicitly mapped so ##NAME## in templates resolves to toName
    expect(fileContent).toContain("NAME: () =>");
  });

  it('should replace ##NAME## with toName from emailLogsData', async () => {
    vi.mock('../init', () => ({
      db: { collection: vi.fn().mockReturnThis(), doc: vi.fn().mockReturnThis(), get: vi.fn() },
    }));
    vi.mock('../constant', () => ({
      constant: { isProduction: false, local_url: 'http://localhost/', live_url: '', TRACKING_PIXEL_URL: '' },
    }));

    const { processEmailTemplate } = await import('../mail-config/mailConfig.js');

    const emailLogsData = {
      toName: 'Gunjan Karun',
      toEmail: 'gunjan+test2@example.com',
      otp: '123456',
      subject: 'Your Arc CMS verification code ##NAME##',
      template: '<p>Hi ##NAME##, your code is ##OTP##.</p>',
    };

    const result = await processEmailTemplate(emailLogsData as any, {});
    expect(result.subject).toBe('Your Arc CMS verification code Gunjan Karun');
    expect(result.template).toContain('Hi Gunjan Karun');
    expect(result.template).not.toContain('##NAME##');
  });

  it('should NOT fall back to email prefix when toName is populated', async () => {
    const { processEmailTemplate } = await import('../mail-config/mailConfig.js');

    const emailLogsData = {
      toName: 'Gunjan Karun',
      toEmail: 'gunjan+test2@example.com',
      subject: 'Hello ##NAME##',
      template: '<p>Hi ##NAME##</p>',
    };

    const result = await processEmailTemplate(emailLogsData as any, {});
    expect(result.subject).not.toContain('gunjan+test2');
    expect(result.subject).toBe('Hello Gunjan Karun');
  });

  it('should fall back to email prefix when toName is absent', async () => {
    const { processEmailTemplate } = await import('../mail-config/mailConfig.js');

    const emailLogsData = {
      toEmail: 'gunjan+test2@example.com',
      subject: 'Hello ##NAME##',
      template: '<p>Hi ##NAME##</p>',
    };

    const result = await processEmailTemplate(emailLogsData as any, {});
    expect(result.subject).toBe('Hello gunjan+test2');
  });
});

describe('Mail Config Functions', () => {
  describe('testSmtpConfigConnection (source structure)', () => {
    it('should require authentication', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testSmtpConfigConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('request.auth');
      expect(fileContent).toContain("'unauthenticated'");
    });

    it('should have timeouts on all external fetch calls', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testSmtpConfigConnection.ts'),
        'utf-8'
      );

      // Every fetch call must include AbortSignal.timeout
      const fetchCount = (fileContent.match(/await fetch\(/g) || []).length;
      const timeoutCount = (fileContent.match(/AbortSignal\.timeout\(/g) || []).length;
      expect(fetchCount).toBeGreaterThan(0);
      expect(timeoutCount).toBe(fetchCount);
    });

    it('should not contain commented-out console.log statements', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testSmtpConfigConnection.ts'),
        'utf-8'
      );

      expect(fileContent).not.toMatch(/\/\/\s*console\.log/);
    });

    it('should use v2 onCall API', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testSmtpConfigConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('firebase-functions/v2/https');
      expect(fileContent).toContain('onCall');
    });

    it('should accept config and activeProvider from request.data', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testSmtpConfigConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('config, activeProvider');
    });

    it('should support all three providers: smtp, gmail, resend', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testSmtpConfigConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain("case 'smtp'");
      expect(fileContent).toContain("case 'gmail'");
      expect(fileContent).toContain("case 'resend'");
    });

    it('should validate SMTP config fields (host, user, password)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testSmtpConfigConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('host');
      expect(fileContent).toContain('user');
      expect(fileContent).toContain('password');
    });

    it('should use nodemailer verify for SMTP and Gmail', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testSmtpConfigConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('nodemailer');
      expect(fileContent).toContain('verify');
    });

    it('should validate Resend API key via fetch', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testSmtpConfigConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('api.resend.com');
      expect(fileContent).toContain('apiKey');
    });

    it('should throw HttpsError for unsupported providers', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testSmtpConfigConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('Unsupported provider');
    });
  });

  describe('testProviderConnection', () => {
    it('should require authentication', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testProviderConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('request.auth');
      expect(fileContent).toContain("'unauthenticated'");
    });

    it('should use v2 onCall API', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testProviderConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('firebase-functions/v2/https');
    });

    it('should handle multiple providers (SMTP, Gmail, Resend)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../mail-config/testProviderConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('SMTP');
      expect(fileContent).toContain('Gmail');
      expect(fileContent).toContain('Resend');
    });
  });
});

describe('Analytics Dashboard Functions', () => {
  describe('testAnalyticsConnection', () => {
    it('should require authentication', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../AnalyticsDashboard/testAnalyticsConnection.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('request.auth');
      expect(fileContent).toContain("'unauthenticated'");
    });

    it('should use v2 onCall API', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../AnalyticsDashboard/testAnalyticsConnection.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain("from 'firebase-functions/v2/https'");
    });

    it('should connect to Google Analytics Data API', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../AnalyticsDashboard/testAnalyticsConnection.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('analyticsdata');
    });

    it('should fetch analytics settings from Firestore', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../AnalyticsDashboard/testAnalyticsConnection.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain("collection('Settings')");
    });
  });
});
