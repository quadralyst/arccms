import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, mockRunTransaction } = vi.hoisted(() => {
  const store: { secret?: string; fail?: boolean } = {};
  const mockRunTransaction = vi.fn(async (fn: (tx: any) => Promise<string>) => {
    if (store.fail) throw new Error('unavailable');
    const tx = {
      get: vi.fn(async () => ({ data: () => (store.secret ? { secret: store.secret } : undefined) })),
      set: vi.fn((_ref: unknown, data: { secret: string }) => { store.secret = data.secret; }),
    };
    return fn(tx);
  });
  return { store, mockRunTransaction };
});

vi.mock('../init', () => ({
  db: {
    collection: vi.fn(() => ({ doc: vi.fn(() => ({ path: '_system/unsubscribe_secret' })) })),
    runTransaction: mockRunTransaction,
  },
}));

import { getUnsubscribeSecret, resetUnsubscribeSecretCache } from '../email-core/unsubscribeSecret.js';

describe('getUnsubscribeSecret', () => {
  beforeEach(() => {
    delete store.secret;
    store.fail = false;
    resetUnsubscribeSecretCache();
    mockRunTransaction.mockClear();
  });

  it('creates a strong secret on first use, where a new install had none', async () => {
    const secret = await getUnsubscribeSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(store.secret).toBe(secret);
  });

  it('reuses the stored secret, so links already sent keep verifying', async () => {
    store.secret = 'a'.repeat(64);
    expect(await getUnsubscribeSecret()).toBe('a'.repeat(64));
  });

  it('caches it per instance', async () => {
    await getUnsubscribeSecret();
    await getUnsubscribeSecret();
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });

  it('keeps a secret an install configured in Settings/email', async () => {
    expect(await getUnsubscribeSecret('configured-secret')).toBe('configured-secret');
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('returns empty (links omitted, as before) when the secret cannot be stored', async () => {
    store.fail = true;
    expect(await getUnsubscribeSecret()).toBe('');
  });
});
