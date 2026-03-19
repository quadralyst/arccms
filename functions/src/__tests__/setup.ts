/**
 * Vitest setup for Cloud Functions tests.
 * Mocks Firebase Admin SDK for unit testing.
 */
import { vi } from 'vitest';

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
