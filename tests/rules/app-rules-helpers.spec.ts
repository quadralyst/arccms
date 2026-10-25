/**
 * The helpers core's rules offer to an app's own rules (docs/app/rules-and-indexes.html),
 * tested through a sample app rule placed the way `npm run rules:build` places it.
 * Runs against the emulators: `npm run test:rules`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { injectAppRules } from '../../scripts/arc-rules-build.mjs';

let env: RulesTestEnvironment;

const core = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

// What an app with front-desk staff accounts would write: its own claim, and only from
// the app's sign-in token.
const FIRESTORE_APP_RULES = `
match /bookings/{id} {
  allow read: if signedInByApp() && request.auth.token.staffRole == 'front-desk';
}
match /orders/{id} {
  allow create: if sessionClaim('pos') != null && request.resource.data.posId == sessionClaim('pos');
}`;
// Core Storage keeps reads public, so the sample guards a write.
const STORAGE_APP_RULES = `
match /bookings/{file} {
  allow write: if signedInByApp() && request.auth.token.staffRole == 'front-desk';
}
match /tills/{pos}/{file} {
  allow write: if sessionClaim('pos') == pos;
}`;

const STAFF = 'staff-uid';
const claims = { arccms_uid: 'staff-doc', arccms_role: 'user', staffRole: 'front-desk' };

/** Signed in with the app's token (the emulator's default, like signInWithCustomToken). */
const byApp = () => env.authenticatedContext(STAFF, claims);
/** The same account and claims, signed in with Google linked in the browser. */
const byGoogle = () => env.authenticatedContext(STAFF, { ...claims, firebase: { sign_in_provider: 'google.com' } });
const byPassword = () => env.authenticatedContext(STAFF, { ...claims, firebase: { sign_in_provider: 'password' } });
const otherStaff = () => env.authenticatedContext('other-uid', { arccms_uid: 'other-doc', arccms_role: 'user' });

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-arccms-rules',
        firestore: { rules: injectAppRules(core('firestore.rules'), FIRESTORE_APP_RULES) },
        storage: { rules: injectAppRules(core('storage.rules'), STORAGE_APP_RULES) },
    });
});

afterAll(async () => {
    await env?.cleanup();
});

beforeEach(async () => {
    await env.clearFirestore();
    await env.clearStorage();
    await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'bookings', 'b1'), { at: '09:00' });
    });
});

describe('signedInByApp() in an app\'s Firestore rules', () => {
    it('lets in a session from the app\'s sign-in token', async () => {
        await assertSucceeds(getDoc(doc(byApp().firestore(), 'bookings', 'b1')));
    });

    it('refuses the same account and claims signed in with Google or a password', async () => {
        await assertFails(getDoc(doc(byGoogle().firestore(), 'bookings', 'b1')));
        await assertFails(getDoc(doc(byPassword().firestore(), 'bookings', 'b1')));
    });

    it('still needs the app\'s own claim', async () => {
        await assertFails(getDoc(doc(otherStaff().firestore(), 'bookings', 'b1')));
    });

    it('refuses a visitor who is not signed in', async () => {
        await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'bookings', 'b1')));
    });
});

describe('sessionClaim() in an app\'s rules (F30)', () => {
    /** Signed in with the app's token carrying session claims, as issueSignInToken(uid, { pos }) makes. */
    const onTill = (pos: unknown, extra: Record<string, unknown> = {}) => env.authenticatedContext(STAFF, { ...claims, ...extra, arccms_session: { pos } });
    const order = (ctx: ReturnType<typeof byApp>, posId: string) => setDoc(doc(ctx.firestore(), 'orders', `o-${posId}`), { posId });

    it('reads the claim the sign-in token carried', async () => {
        await assertSucceeds(order(onTill('pos-2'), 'pos-2'));
        await assertFails(order(onTill('pos-2'), 'pos-3'));
    });

    it('never answers with an account claim of the same name', async () => {
        const accountClaimOnly = env.authenticatedContext(STAFF, { ...claims, pos: 'pos-2' });
        await assertFails(order(accountClaimOnly, 'pos-2'));
        // and the session's own claim wins over an account claim that says otherwise
        await assertFails(order(onTill('pos-2', { pos: 'pos-3' }), 'pos-3'));
        await assertSucceeds(order(onTill('pos-2', { pos: 'pos-3' }), 'pos-2'));
    });

    it('is null for a session with no session claims, and for a visitor', async () => {
        await assertFails(order(byApp(), 'pos-2'));
        await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'orders', 'o-1'), { posId: 'pos-2' }));
    });

    it('works in Storage rules too', async () => {
        const upload = (ctx: ReturnType<typeof byApp>, pos: string) => uploadBytes(ref(ctx.storage(), `tills/${pos}/receipt.txt`), new Uint8Array([1]));
        await assertSucceeds(upload(onTill('pos-2'), 'pos-2'));
        await assertFails(upload(onTill('pos-2'), 'pos-3'));
        await assertFails(upload(env.authenticatedContext(STAFF, { ...claims, pos: 'pos-3' }), 'pos-3'));
    });
});

describe('signedInByApp() in an app\'s Storage rules', () => {
    const upload = (ctx: ReturnType<typeof byApp>) => uploadBytes(ref(ctx.storage(), 'bookings/today.txt'), new Uint8Array([1]));

    it('lets in a session from the app\'s sign-in token', async () => {
        await assertSucceeds(upload(byApp()));
    });

    it('refuses the same account and claims signed in with Google', async () => {
        await assertFails(upload(byGoogle()));
    });

    it('refuses a visitor who is not signed in', async () => {
        await assertFails(upload(env.unauthenticatedContext()));
    });
});
