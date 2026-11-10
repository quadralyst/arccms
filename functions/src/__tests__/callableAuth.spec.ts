/**
 * Regression tests: the connection test callables and the Unsplash search are
 * for admins only, not for any signed-in account.
 *
 * Two layers of protection:
 *   1. Source-code analysis: each calls requireAdmin(request) first.
 *   2. Behavioural tests: no auth answers 'unauthenticated', a signed-in account
 *      that is not an admin answers 'permission-denied'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Mocks ────────────────────────────────────────────────────────────

// Mock onCall to extract the handler (supports both 1-arg and 2-arg forms)
vi.mock('firebase-functions/v2/https', () => {
  class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  }

  return {
    onCall: vi.fn((...args: any[]) => (args.length === 2 ? args[1] : args[0])),
    HttpsError,
  };
});

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    get: vi.fn(),
  })),
  Timestamp: {
    now: vi.fn(() => ({ seconds: Date.now() / 1000, nanoseconds: 0 })),
  },
  FieldValue: {
    increment: vi.fn((n: number) => ({ _increment: n })),
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
  },
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({})),
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: vi.fn(() => ({})),
}));

vi.mock('../../init', () => ({
  db: {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    get: vi.fn(),
  },
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    get: vi.fn(),
  },
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn() },
  createTransport: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    analyticsdata: vi.fn(),
    analyticsadmin: vi.fn(),
  },
}));

// ── Source-code analysis tests ───────────────────────────────────────

describe('Callable function authentication — source analysis', () => {
  const callableSources = [
    {
      name: 'testSmtpConfigConnection',
      path: '../mail-config/testSmtpConfigConnection.ts',
    },
    {
      name: 'testProviderConnection',
      path: '../mail-config/testProviderConnection.ts',
    },
    {
      name: 'testAnalyticsConnection',
      path: '../AnalyticsDashboard/testAnalyticsConnection.ts',
    },
    {
      name: 'searchUnsplash',
      path: '../integrations/searchUnsplash.ts',
    },
  ];

  for (const { name, path } of callableSources) {
    it(`${name} should check for an admin before processing`, async () => {
      const fs = await import('fs');
      const pathModule = await import('path');
      const src = fs.readFileSync(
        pathModule.resolve(__dirname, path),
        'utf-8',
      );

      // The admin guard MUST appear before any business logic
      expect(src).toContain("import { requireAdmin } from '../search/auth.js'");
      expect(src).toContain('await requireAdmin(request);');
      const body = src.slice(src.indexOf('async (request'));
      expect(body.indexOf('await requireAdmin(request);')).toBeGreaterThan(-1);
      // Nothing reads the request's data or settings before the check.
      const firstWork = Math.min(...['request.data', 'try {'].map((m) => body.indexOf(m)).filter((i) => i >= 0));
      expect(body.indexOf('await requireAdmin(request);')).toBeLessThan(firstWork);
    });

    it(`${name} should use the v2 callable API`, async () => {
      const fs = await import('fs');
      const pathModule = await import('path');
      const src = fs.readFileSync(
        pathModule.resolve(__dirname, path),
        'utf-8',
      );

      expect(src).toContain("firebase-functions/v2/https");
    });
  }
});

// ── Behavioural tests ────────────────────────────────────────────────

describe('Callable function authentication — behavioural', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('testSmtpConfigConnection rejects unauthenticated calls', async () => {
    const { testSmtpConfigConnection } = await import(
      '../mail-config/testSmtpConfigConnection.js'
    );

    // Our onCall mock returns the raw handler; cast to any for direct invocation
    const handler = testSmtpConfigConnection as any;
    await expect(
      handler({
        auth: null,
        data: { config: {}, activeProvider: 'smtp' },
      }),
    ).rejects.toThrow('Authentication required.');
  });

  it('testSmtpConfigConnection rejects when auth is undefined', async () => {
    const { testSmtpConfigConnection } = await import(
      '../mail-config/testSmtpConfigConnection.js'
    );

    const handler = testSmtpConfigConnection as any;
    await expect(
      handler({
        data: { config: {}, activeProvider: 'smtp' },
      }),
    ).rejects.toThrow('Authentication required.');
  });

  it('testProviderConnection rejects unauthenticated calls', async () => {
    const { testProviderConnection } = await import(
      '../mail-config/testProviderConnection.js'
    );

    const handler = testProviderConnection as any;
    await expect(
      handler({
        auth: null,
        data: { activeProvider: 'smtp', config: {} },
      }),
    ).rejects.toThrow('Authentication required.');
  });

  it('testProviderConnection rejects when auth is undefined', async () => {
    const { testProviderConnection } = await import(
      '../mail-config/testProviderConnection.js'
    );

    const handler = testProviderConnection as any;
    await expect(
      handler({
        data: { activeProvider: 'smtp', config: {} },
      }),
    ).rejects.toThrow('Authentication required.');
  });

  it('testAnalyticsConnection rejects unauthenticated calls', async () => {
    const { testAnalyticsConnection } = await import(
      '../AnalyticsDashboard/testAnalyticsConnection.js'
    );

    const handler = testAnalyticsConnection as any;
    await expect(
      handler({
        auth: null,
        data: {},
      }),
    ).rejects.toThrow('Authentication required.');
  });

  it('testAnalyticsConnection rejects when auth is undefined', async () => {
    const { testAnalyticsConnection } = await import(
      '../AnalyticsDashboard/testAnalyticsConnection.js'
    );

    const handler = testAnalyticsConnection as any;
    await expect(
      handler({
        data: {},
      }),
    ).rejects.toThrow('Authentication required.');
  });

  const member = { uid: 'member-1', token: { arccms_role: 'user' } };
  const nonAdminCases: Array<[string, () => Promise<any>, any]> = [
    ['testSmtpConfigConnection', async () => (await import('../mail-config/testSmtpConfigConnection.js')).testSmtpConfigConnection, { config: {}, activeProvider: 'smtp' }],
    ['testProviderConnection', async () => (await import('../mail-config/testProviderConnection.js')).testProviderConnection, { activeProvider: 'smtp', config: {} }],
    ['testAnalyticsConnection', async () => (await import('../AnalyticsDashboard/testAnalyticsConnection.js')).testAnalyticsConnection, {}],
    ['searchUnsplash', async () => (await import('../integrations/searchUnsplash.js')).searchUnsplash, { query: 'sea', page: 1 }],
  ];
  for (const [name, load, data] of nonAdminCases) {
    it(`${name} refuses a signed-in account that is not an admin`, async () => {
      const handler = (await load()) as any;
      await expect(handler({ auth: member, data })).rejects.toMatchObject({ code: 'permission-denied' });
    });
  }

  it('searchUnsplash refuses an unauthenticated call', async () => {
    const { searchUnsplash } = await import('../integrations/searchUnsplash.js');
    await expect((searchUnsplash as any)({ auth: null, data: { query: 'sea', page: 1 } }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
