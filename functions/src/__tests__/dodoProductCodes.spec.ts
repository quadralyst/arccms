/**
 * Tier discount codes live in the admin-only ProductCodes document, not on the
 * public Products document (functions/src/dodo-payments/productCodes.ts). Checkout
 * reads them there, falling back to a code an older admin page left on the
 * product; the admin test link reads them by tier position and stamps a token
 * only it makes (testCheckouts.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({ getUser: vi.fn() }));
const createSession = vi.hoisted(() => vi.fn());

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((handler: unknown) => handler),
    HttpsError: class extends Error {
        constructor(public code: string, message: string) {
            super(message);
        }
    },
}));
vi.mock('../dodo-payments/dodoClient', () => ({
    getDodoClient: async () => ({
        client: { checkoutSessions: { create: createSession } },
        settings: { successUrl: 'https://site.test/done' },
    }),
}));

import { db } from '../init.js';
import { createCheckoutSession } from '../dodo-payments/createCheckoutSession.js';
import { createTestCheckoutLink } from '../dodo-payments/createTestCheckoutLink.js';
import { loadProductCodes, tierDiscountCode } from '../dodo-payments/productCodes.js';
import { isAdminTestCheckout, TEST_CHECKOUT_TTL_MS } from '../dodo-payments/testCheckouts.js';
import { moveProductCodes, moveProductCodesOf } from '../dodo-payments/moveProductCodes.js';
import { FakeTimestamp } from './helpers/memoryFirestore.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
type Handler = (request: unknown) => Promise<any>;
const call = (fn: unknown, data: Record<string, unknown>, uid: string, token: Record<string, unknown> = {}) =>
    (fn as Handler)({ data, auth: { uid, token } });

const tiers = [
    { label: 'First 10', maxCount: 10, discountPct: 50 },
    { label: 'Everyone else', maxCount: 0, discountPct: 0 },
];
const product = {
    name: 'Gold', active: true, type: 'one_time', premiumType: 'gold', tierRank: 1,
    providerProductIds: { dodo: 'prod_gold' }, tiers, purchaseCount: 0,
};
const sentParams = () => createSession.mock.calls[createSession.mock.calls.length - 1][0];

beforeEach(() => {
    mem.store.clear();
    vi.clearAllMocks();
    createSession.mockResolvedValue({ checkout_url: 'https://pay.test/c', session_id: 's1' });
    owner.getUser.mockImplementation(async (uid: string) => ({
        uid, email: `${uid}@site.test`, customClaims: uid === 'admin1' ? { arccms_role: 'admin' } : {},
    }));
});

describe('tierDiscountCode', () => {
    it('takes the stored code at the tier position', () => {
        expect(tierDiscountCode(tiers, tiers[0], ['EARLY', ''])).toBe('EARLY');
        expect(tierDiscountCode(tiers, tiers[1], ['EARLY', ''])).toBe('');
    });

    it('falls back to a code still on the product', () => {
        const legacy = [{ ...tiers[0], discountCode: 'OLD' }, tiers[1]];
        expect(tierDiscountCode(legacy, legacy[0], [])).toBe('OLD');
    });

    it('is empty with no tier', () => {
        expect(tierDiscountCode(tiers, null, ['EARLY'])).toBe('');
    });
});

describe('loadProductCodes', () => {
    it('reads the codes, and nothing for a product without a document', async () => {
        mem.seed('ProductCodes', 'p1', { discountCodes: ['EARLY', 7] });
        expect(await loadProductCodes('p1')).toEqual(['EARLY', '']);
        expect(await loadProductCodes('p2')).toEqual([]);
    });
});

describe('createCheckoutSession', () => {
    it('applies the current tier code from ProductCodes', async () => {
        mem.seed('Products', 'p1', product);
        mem.seed('ProductCodes', 'p1', { discountCodes: ['EARLY', ''] });
        await call(createCheckoutSession, { productId: 'p1' }, 'u1', { email: 'u1@site.test' });

        expect(sentParams().discount_codes).toEqual(['EARLY']);
        expect(sentParams().metadata).toMatchObject({ productId: 'p1', discountCode: 'EARLY', tierLabel: 'First 10' });
    });

    it('uses a code still on the product when ProductCodes has none', async () => {
        mem.seed('Products', 'p1', { ...product, tiers: [{ ...tiers[0], discountCode: 'OLD' }, tiers[1]] });
        await call(createCheckoutSession, { productId: 'p1' }, 'u1', { email: 'u1@site.test' });

        expect(sentParams().discount_codes).toEqual(['OLD']);
    });

    it('sends no code for a full-price tier', async () => {
        mem.seed('Products', 'p1', { ...product, purchaseCount: 10 });
        mem.seed('ProductCodes', 'p1', { discountCodes: ['EARLY', ''] });
        await call(createCheckoutSession, { productId: 'p1' }, 'u1', { email: 'u1@site.test' });

        expect(sentParams().discount_codes).toBeUndefined();
        expect(sentParams().metadata.discountCode).toBe('');
    });
});

describe('createTestCheckoutLink', () => {
    it('refuses a member', async () => {
        mem.seed('Products', 'p1', product);
        await expect(call(createTestCheckoutLink, { productId: 'p1', tierIndex: 0 }, 'u1')).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('applies the code of the tier asked for, and stamps a token it keeps', async () => {
        mem.seed('Products', 'p1', product);
        mem.seed('ProductCodes', 'p1', { discountCodes: ['EARLY', ''] });
        await call(createTestCheckoutLink, { productId: 'p1', tierIndex: 0 }, 'admin1');

        const { metadata, discount_codes } = sentParams();
        expect(discount_codes).toEqual(['EARLY']);
        expect(metadata.test).toMatch(/^t_[0-9a-f]{32}$/);
        expect(mem.read('TestCheckouts', metadata.test)).toMatchObject({ productId: 'p1', adminUid: 'admin1' });
        expect(await isAdminTestCheckout({ metadata })).toBe(true);
    });

    it('refuses a tier the product does not have', async () => {
        mem.seed('Products', 'p1', product);
        await expect(call(createTestCheckoutLink, { productId: 'p1', tierIndex: 5 }, 'admin1')).rejects.toMatchObject({ code: 'invalid-argument' });
    });
});

describe('isAdminTestCheckout', () => {
    it('is false for a plain flag, an unknown token and a token for another product', async () => {
        mem.seed('TestCheckouts', `t_${'a'.repeat(32)}`, { productId: 'p2' });
        expect(await isAdminTestCheckout({ metadata: { test: 'true', productId: 'p1' } })).toBe(false);
        expect(await isAdminTestCheckout({ metadata: { test: `t_${'b'.repeat(32)}`, productId: 'p1' } })).toBe(false);
        expect(await isAdminTestCheckout({ metadata: { test: `t_${'a'.repeat(32)}`, productId: 'p1' } })).toBe(false);
    });
});

describe('createTestCheckoutLink when the gateway call fails', () => {
    it('removes the token it kept, so it can never be used', async () => {
        mem.seed('Products', 'p1', product);
        createSession.mockRejectedValue(new Error('gateway down'));
        await expect(call(createTestCheckoutLink, { productId: 'p1', tierIndex: 0 }, 'admin1')).rejects.toMatchObject({ code: 'internal' });
        expect(mem.all('TestCheckouts')).toEqual([]);
    });
});

describe('isAdminTestCheckout over time', () => {
    const token = `t_${'e'.repeat(32)}`;
    const keep = (msAgo: number, extra: Record<string, unknown> = {}) =>
        mem.seed('TestCheckouts', token, { productId: 'p1', createdAt: FakeTimestamp.fromMillis(Date.now() - msAgo), ...extra });

    it('counts a fresh link, and binds it to the checkout\'s payment and subscription', async () => {
        keep(1000);
        expect(await isAdminTestCheckout({ metadata: { test: token, productId: 'p1' }, payment_id: 'pay1', subscription_id: 'sub1' })).toBe(true);
        expect(mem.read('TestCheckouts', token)).toMatchObject({ paymentIds: ['pay1'], subscriptionIds: ['sub1'] });
    });

    it('does not count an unused link older than a week', async () => {
        keep(TEST_CHECKOUT_TTL_MS + 1000);
        expect(await isAdminTestCheckout({ metadata: { test: token, productId: 'p1' }, payment_id: 'pay2' })).toBe(false);
    });

    it('still counts the bound subscription and payment of an old link', async () => {
        keep(TEST_CHECKOUT_TTL_MS * 5, { paymentIds: ['pay1'], subscriptionIds: ['sub1'] });
        expect(await isAdminTestCheckout({ metadata: { test: token, productId: 'p1' }, subscription_id: 'sub1' })).toBe(true);
        expect(await isAdminTestCheckout({ metadata: { test: token, productId: 'p1' }, payment_id: 'pay1' })).toBe(true);
        expect(await isAdminTestCheckout({ metadata: { test: token, productId: 'p1' }, subscription_id: 'sub9' })).toBe(false);
    });
});

describe('moveProductCodes', () => {
    const legacyTiers = [{ ...tiers[0], discountCode: 'EARLY' }, { ...tiers[1], discountCode: '' }];

    it('refuses a member', async () => {
        await expect(call(moveProductCodes, {}, 'u1')).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('moves the codes off the public product into ProductCodes', async () => {
        mem.seed('Products', 'p1', { ...product, tiers: legacyTiers });
        expect(await call(moveProductCodes, {}, 'admin1', { arccms_role: 'admin' })).toEqual({ moved: 1 });

        expect(mem.read('ProductCodes', 'p1')).toMatchObject({ discountCodes: ['EARLY', ''] });
        const saved = mem.read('Products', 'p1') as { tiers: object[] };
        expect(saved.tiers.every((t) => !('discountCode' in t))).toBe(true);
        expect(saved.tiers[0]).toMatchObject({ label: 'First 10', maxCount: 10, discountPct: 50 });
    });

    it('never drops a code already stored, and fills only empty places', async () => {
        mem.seed('Products', 'p1', { ...product, tiers: [{ ...tiers[0], discountCode: 'OLD' }, { ...tiers[1], discountCode: 'LATE' }] });
        mem.seed('ProductCodes', 'p1', { discountCodes: ['KEPT', '', 'BEYOND'] });
        await moveProductCodesOf('p1');

        expect(mem.read('ProductCodes', 'p1')).toMatchObject({ discountCodes: ['KEPT', 'LATE', 'BEYOND'] });
    });

    it('leaves products without codes alone, however many there are', async () => {
        for (let i = 0; i < 300; i++) mem.seed('Products', `p${i}`, { ...product, tiers: i % 100 === 0 ? legacyTiers : tiers });
        expect(await call(moveProductCodes, {}, 'admin1', { arccms_role: 'admin' })).toEqual({ moved: 3 });
        expect(mem.read('ProductCodes', 'p1')).toBeUndefined();
        expect(mem.read('ProductCodes', 'p200')).toMatchObject({ discountCodes: ['EARLY', ''] });
    });
});
