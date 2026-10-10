/**
 * Vitest setup for Cloud Functions tests.
 * Mocks Firebase Admin SDK for unit testing.
 */
import { expect, vi } from 'vitest';

/**
 * Core function specs see the custom starter files as Arc CMS ships them, empty
 * (scripts/custom-starters.mjs), whatever an app puts there: no app functions, no
 * extra search sources. An app's own specs (functions/src/custom) see the real
 * files. A spec about a particular choice mocks the file itself.
 */
async function starter(file: string, actual: () => Promise<unknown>) {
  // @ts-expect-error: plain ESM script without type declarations
  const { starterFor } = await import('../../../scripts/custom-starters.mjs');
  return starterFor(file, expect.getState().testPath, actual);
}
vi.mock('../custom/index.js', (actual) => starter('functions/src/custom/index.ts', actual));
vi.mock('../custom/search-sources.js', (actual) => starter('functions/src/custom/search-sources.ts', actual));

/**
 * Core function specs run with every feature on (specs/feature-flags-spec.md),
 * whatever an app built on Arc CMS turns off in src/custom/features.ts. A spec
 * about a particular choice mocks '../feature-flags.js' itself.
 */
/**
 * Core function specs run with the strict password and PIN rule, whatever an app
 * chooses in src/custom/sign-in.ts. A spec about the simple rule mocks
 * '../sign-in-choice.js' itself.
 */
vi.mock('../sign-in.gen.js', () => ({ SIGN_IN_STRENGTH: 'strict' }));

vi.mock('../enabled-features.gen.js', () => ({
  ENABLED_FEATURES: ['content', 'search', 'seo', 'forms', 'audience', 'email-marketing', 'sms', 'payments', 'data', 'pwa'],
}));

// Mock firebase-admin/app
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}));

// Mock firebase-admin/firestore
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
  })),
  Timestamp: {
    now: vi.fn(() => ({ seconds: Date.now() / 1000, nanoseconds: 0 })),
    fromDate: vi.fn((date: Date) => ({ seconds: date.getTime() / 1000, nanoseconds: 0 })),
  },
  FieldValue: {
    increment: vi.fn((n: number) => ({ _increment: n })),
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
    delete: vi.fn(() => ({ _delete: true })),
  },
}));

// Mock firebase-admin/auth
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({})),
}));

// Mock firebase-admin/storage
vi.mock('firebase-admin/storage', () => ({
  getStorage: vi.fn(() => ({})),
}));

// Legacy firebase-admin mock (for tests that still reference it)
vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: vi.fn(),
    firestore: vi.fn(() => ({
      collection: vi.fn(),
      doc: vi.fn(),
    })),
    auth: vi.fn(() => ({})),
    storage: vi.fn(() => ({})),
  },
  firestore: {
    Timestamp: {
      now: vi.fn(() => ({ seconds: Date.now() / 1000, nanoseconds: 0 })),
    },
    FieldValue: {
      increment: vi.fn((n: number) => ({ _increment: n })),
      serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
    },
  },
}));
