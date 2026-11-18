/**
 * What a person may do to their own account (src/custom/own-account.ts, F44): the
 * pages read it through src/app/core/sign-in/own-account.ts, the functions through
 * the copy scripts/arc-features.mjs writes (functions/src/own-account.gen.ts).
 */
import { describe, it, expect } from 'vitest';
import { resolveOwnAccount } from './own-account';
import { CUSTOM_OWN_ACCOUNT } from '../../custom/own-account';

describe('resolveOwnAccount', () => {
    it('allows both when the app said nothing, as Arc CMS ships it', () => {
        expect(resolveOwnAccount(undefined)).toEqual({ selfDelete: true, moveIdentifiers: true });
        expect(resolveOwnAccount(CUSTOM_OWN_ACCOUNT)).toEqual({ selfDelete: true, moveIdentifiers: true });
    });

    it('takes a choice of false, and of true', () => {
        expect(resolveOwnAccount({ selfDelete: false })).toEqual({ selfDelete: false, moveIdentifiers: true });
        expect(resolveOwnAccount({ moveIdentifiers: false, selfDelete: true })).toEqual({ selfDelete: true, moveIdentifiers: false });
    });

    it('stops the build on anything else, saying what to write', () => {
        expect(() => resolveOwnAccount({ selfDelete: 'no' } as never)).toThrow(/selfDelete: false/);
        expect(() => resolveOwnAccount({ moveIdentifiers: 0 } as never)).toThrow(/moveIdentifiers: false/);
    });
});
