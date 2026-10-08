/**
 * Sealing a sign-in code so it can be sent again (functions/src/auth/codeSeal.ts,
 * specs/sign-in-codes-spec.md SC4).
 */
import { describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

vi.mock('../auth/accounts', () => ({ pinPepper: async () => 'test-pepper' }));

import { CODE_REUSE_MS, codeSealKey, openCode, resendWait, reusableCode, sealCode } from '../auth/codeSeal.js';

const KEY = randomBytes(32);
const DOC = 'doc-a';
const at = (ms: number) => ({ toMillis: () => ms });
const hash = (code: string) => createHash('sha256').update(`${DOC}:${code}`).digest('hex');

describe('sealCode and openCode', () => {
    it('opens what it sealed, and the sealed text is not the code', () => {
        const sealed = sealCode('482913', DOC, KEY);
        expect(sealed).not.toContain('482913');
        expect(openCode(sealed, DOC, KEY)).toBe('482913');
        expect(sealCode('482913', DOC, KEY)).not.toBe(sealed); // a new IV each time
    });

    it('opens nothing for another document, another key, or damaged text', () => {
        const sealed = sealCode('482913', DOC, KEY);
        expect(openCode(sealed, 'doc-b', KEY)).toBeNull();
        expect(openCode(sealed, DOC, randomBytes(32))).toBeNull();
        expect(openCode(sealed.slice(0, -2) + 'AA', DOC, KEY)).toBeNull();
        expect(openCode('v2.a.b.c', DOC, KEY)).toBeNull();
        expect(openCode(undefined, DOC, KEY)).toBeNull();
    });

    it('derives a 32-byte key from the PIN pepper, the same each time', async () => {
        const key = await codeSealKey();
        expect(key).toHaveLength(32);
        expect((await codeSealKey()).equals(key)).toBe(true);
    });
});

describe('reusableCode', () => {
    const now = Date.now();
    const record = (fields: Record<string, unknown> = {}) => ({
        codeHash: hash('482913'),
        codeSealed: sealCode('482913', DOC, KEY),
        issuedAt: at(now - 60_000),
        expiresAt: at(now + 60_000),
        attempts: 2,
        verified: false,
        ...fields,
    });
    const check = { samePurpose: true, docId: DOC, key: KEY, now, maxAttempts: 5, hash };

    it('gives the stored code while it still works', () => {
        expect(reusableCode(record(), check)).toBe('482913');
    });

    it.each([
        ['no record', undefined, check],
        ['another purpose', record(), { ...check, samePurpose: false }],
        ['verified', record({ verified: true }), check],
        ['expired', record({ expiresAt: at(now - 1) }), check],
        ['out of tries', record({ attempts: 5 }), check],
        ['too old', record({ issuedAt: at(now - CODE_REUSE_MS) }), check],
        ['no sealed code', record({ codeSealed: undefined }), check],
        ['a hash for another code', record({ codeHash: hash('111111') }), check],
    ])('gives null for %s', (_, data, args) => {
        expect(reusableCode(data, args)).toBeNull();
    });
});

describe('resendWait', () => {
    it('counts the seconds left of the gap, rounding up', () => {
        const now = Date.now();
        expect(resendWait({ lastSentAt: at(now - 20_500) }, now, 60_000)).toBe(40);
        expect(resendWait({ lastSentAt: at(now - 60_000) }, now, 60_000)).toBe(0);
        expect(resendWait(undefined, now, 60_000)).toBe(0);
    });
});
