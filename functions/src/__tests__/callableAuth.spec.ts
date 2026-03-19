/**
 * Regression tests — every callable function that handles sensitive
 * operations MUST reject unauthenticated callers.
 *
 * Two layers of protection:
 *   1. Source-code analysis: the auth guard pattern MUST be present in source.
 *   2. Behavioural tests: importing the handler and calling it without
 *      `request.auth` MUST throw an HttpsError('unauthenticated').
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
      name: 'getOptimizedLeaderboard',
      path: '../waitlists/leaderboard/getLeaderBoardData.ts',
    },
  ];

  for (const { name, path } of callableSources) {
    it(`${name} should check request.auth before processing`, async () => {
      const fs = await import('fs');
      const pathModule = await import('path');
      const src = fs.readFileSync(
        pathModule.resolve(__dirname, path),
        'utf-8',
      );

      // The auth guard MUST appear before any business logic
      expect(src).toContain('request.auth');
      expect(src).toContain("'unauthenticated'");
      expect(src).toContain('HttpsError');
    });

    it(`${name} should import HttpsError`, async () => {
      const fs = await import('fs');
      const pathModule = await import('path');
      const src = fs.readFileSync(
        pathModule.resolve(__dirname, path),
        'utf-8',
      );

      expect(src).toContain('HttpsError');
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

  it('getOptimizedLeaderboard rejects unauthenticated calls', async () => {
    const { getOptimizedLeaderboard } = await import(
      '../waitlists/leaderboard/getLeaderBoardData.js'
    );

    const handler = getOptimizedLeaderboard as any;
    await expect(
      handler({
        auth: null,
        data: {},
      }),
    ).rejects.toThrow('Authentication required.');
  });

  it('getOptimizedLeaderboard rejects when auth is undefined', async () => {
    const { getOptimizedLeaderboard } = await import(
      '../waitlists/leaderboard/getLeaderBoardData.js'
    );

    const handler = getOptimizedLeaderboard as any;
    await expect(
      handler({
        data: {},
      }),
    ).rejects.toThrow('Authentication required.');
  });
});

// ── collectionName validation tests ──────────────────────────────────

describe('getOptimizedLeaderboard — collectionName validation', () => {
  let handler: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../waitlists/leaderboard/getLeaderBoardData.js');
    handler = mod.getOptimizedLeaderboard as any;
  });

  const authRequest = (data: any) => ({ auth: { uid: 'test-user' }, data });

  // ── Rejection: arbitrary collection names ────────────────────────

  it('rejects arbitrary collection name "Settings"', async () => {
    await expect(
      handler(authRequest({ collectionName: 'Settings' })),
    ).rejects.toThrow('Invalid collection name.');
  });

  it('rejects arbitrary collection name "users"', async () => {
    await expect(
      handler(authRequest({ collectionName: 'users' })),
    ).rejects.toThrow('Invalid collection name.');
  });

  it('rejects arbitrary collection name "EmailLog"', async () => {
    await expect(
      handler(authRequest({ collectionName: 'EmailLog' })),
    ).rejects.toThrow('Invalid collection name.');
  });

  it('rejects paths that do not match Waitlists/{id}/users pattern', async () => {
    await expect(
      handler(authRequest({ collectionName: 'Waitlists/abc' })),
    ).rejects.toThrow('Invalid collection name.');
  });

  it('rejects path traversal attempts', async () => {
    await expect(
      handler(authRequest({ collectionName: 'Waitlists/../Settings/users' })),
    ).rejects.toThrow('Invalid collection name.');
  });

  it('rejects Waitlists/{id}/users when waitlist does not exist', async () => {
    const { db } = await import('../init.js');
    (db as any).get.mockResolvedValue({ exists: false });

    await expect(
      handler(authRequest({ collectionName: 'Waitlists/nonexistent-id/users' })),
    ).rejects.toThrow('Invalid collection name.');
  });

  // ── Acceptance: valid collection names ───────────────────────────
  // After passing validation the function will continue with Firestore
  // queries that may fail due to simplified mocks — that is fine.
  // We only assert that it does NOT throw "Invalid collection name."

  it('allows default WaitlistedUsers when collectionName is omitted', async () => {
    try {
      await handler(authRequest({}));
    } catch (e: any) {
      expect(e.message).not.toBe('Invalid collection name.');
    }
  });

  it('allows explicit "WaitlistedUsers" collectionName', async () => {
    try {
      await handler(authRequest({ collectionName: 'WaitlistedUsers' }));
    } catch (e: any) {
      expect(e.message).not.toBe('Invalid collection name.');
    }
  });

  it('allows Waitlists/{id}/users when waitlist exists', async () => {
    const { db } = await import('../init.js');
    (db as any).get.mockResolvedValue({ exists: true });

    try {
      await handler(authRequest({ collectionName: 'Waitlists/valid-waitlist-id/users' }));
    } catch (e: any) {
      expect(e.message).not.toBe('Invalid collection name.');
    }
  });
});
