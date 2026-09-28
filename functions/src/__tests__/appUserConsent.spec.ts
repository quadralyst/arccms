/** Whether an app user may get marketing email (review C4). */
import { describe, it, expect } from 'vitest';
import { appUserSubscribed } from '../email-core/appUserConsent.js';

describe('appUserSubscribed', () => {
    it("lets a contact's own choice win, and defers to the app user otherwise", () => {
        expect(appUserSubscribed('unsubscribed', true)).toBe(false);
        expect(appUserSubscribed('subscribed', false)).toBe(true);
        expect(appUserSubscribed('pending', true)).toBe(true);
        expect(appUserSubscribed('pending', false)).toBe(false);
        expect(appUserSubscribed(null, true)).toBe(true);
        expect(appUserSubscribed(undefined, false)).toBe(false);
    });
});
