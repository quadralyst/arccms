/**
 * Firestore rules: role self-promotion and staff-only content writes (CO1).
 * Runs against the emulator: `npm run test:rules`.
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
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';

let env: RulesTestEnvironment;

const ALICE = 'alice-uid';
const BOB = 'bob-uid';

const alice = () => env.authenticatedContext(ALICE).firestore();
const admin = () => env.authenticatedContext('admin-uid', { arccms_role: 'admin' }).firestore();
const editor = () => env.authenticatedContext('editor-uid', { arccms_role: 'editor' }).firestore();
// A host app's own admin in a shared sign-in pool (CO-D7): not an ArcCMS admin.
const hostAdmin = () => env.authenticatedContext('host-uid', { role: 'admin' }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-arccms-rules',
        firestore: { rules: readFileSync(resolve(__dirname, '../../.arc-build/firestore.rules'), 'utf8') },
    });
});

afterAll(async () => {
    await env?.cleanup();
});

beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'users', 'alice-doc'), { uid: ALICE, email: 'a@x.com', role: 'user', isActive: true, status: 'Active', emailVerified: false });
        await setDoc(doc(db, 'users', 'bob-doc'), { uid: BOB, email: 'b@x.com', role: 'user', isActive: true, status: 'Active' });
        await setDoc(doc(db, 'ContentTypes', 'articles'), { slug: 'articles' });
        await setDoc(doc(db, 'arc_articles', 'p1'), { title: 'Hello' });
        await setDoc(doc(db, 'arc_articles_drafts', 'd1'), { title: 'Draft' });
        await setDoc(doc(db, 'Tags_articles', 't1'), { name: 'news' });
    });
});

describe('users: create (review F: sign-ups create records on the server)', () => {
    const carol = () => env.authenticatedContext('carol-uid').firestore();

    it('refuses a record a person creates for themselves, even with role user', async () => {
        await assertFails(addDoc(collection(alice(), 'users'), { uid: ALICE, email: 'a2@x.com', role: 'user' }));
        await assertFails(addDoc(collection(carol(), 'users'), { uid: 'carol-uid', email: 'c@x.com' }));
    });

    it('refuses forged plans, credits and other people\'s emails', async () => {
        await assertFails(addDoc(collection(carol(), 'users'), { uid: 'carol-uid', email: 'victim@x.com', emailVerified: true }));
        await assertFails(addDoc(collection(carol(), 'users'), { uid: 'carol-uid', isPro: true, creditBalance: 1e9 }));
    });

    it('refuses unauthenticated creates', async () => {
        await assertFails(addDoc(collection(anon(), 'users'), { uid: ALICE, role: 'user' }));
    });

    it('refuses an admin too: Add user is a callable (adminCreateUser), and a record on someone\'s uid would replace their claims', async () => {
        await assertFails(addDoc(collection(admin(), 'users'), { uid: 'new', role: 'admin' }));
        await assertFails(setDoc(doc(admin(), 'users', 'twin-doc'), { uid: BOB, role: 'user', isActive: false }));
    });

    it('never accepts a password in a user record, from anyone', async () => {
        await assertFails(addDoc(collection(admin(), 'users'), { uid: 'new', role: 'user', password: 'hunter2' }));
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { password: 'hunter2' }));
        await assertFails(updateDoc(doc(admin(), 'users', 'alice-doc'), { password: 'hunter2' }));
    });
});

describe('users: update', () => {
    it('lets a user edit their own name and photo', async () => {
        await assertSucceeds(updateDoc(doc(alice(), 'users', 'alice-doc'), { name: 'Alice', photo: 'https://x/y.webp' }));
    });

    it('refuses a user changing their own role (the escalation)', async () => {
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { role: 'admin' }));
    });

    it('refuses a user changing uid, isActive or status', async () => {
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { uid: BOB }));
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { isActive: false }));
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { status: 'Disable' }));
    });

    it('lets emailVerified go to false but not to true', async () => {
        await env.withSecurityRulesDisabled((ctx) =>
            updateDoc(doc(ctx.firestore(), 'users', 'alice-doc'), { emailVerified: true }));
        await assertSucceeds(updateDoc(doc(alice(), 'users', 'alice-doc'), { emailVerified: false }));
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { emailVerified: true }));
    });

    it('leaves email and phone to the server, which changes them after a code', async () => {
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { email: 'n@x.com' }));
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { phone: '+15550100' }));
    });

    it('still refuses premium fields', async () => {
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { isPro: true }));
        // What granted the access: a renewal or refund is matched against these.
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { premiumProductId: 'gold' }));
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { premiumPaymentId: 'pay_1' }));
    });

    it("refuses editing someone else's doc", async () => {
        await assertFails(updateDoc(doc(alice(), 'users', 'bob-doc'), { name: 'pwned' }));
    });

    it('refuses an admin changing a role, a block or the sign-in: those go through the callables, which keep an active admin (RF4)', async () => {
        await assertFails(updateDoc(doc(admin(), 'users', 'alice-doc'), { role: 'admin' }));
        await assertFails(updateDoc(doc(admin(), 'users', 'alice-doc'), { isActive: false }));
        await assertFails(updateDoc(doc(admin(), 'users', 'alice-doc'), { status: 'Disable' }));
        await assertFails(updateDoc(doc(admin(), 'users', 'alice-doc'), { uid: BOB }));
    });

    it('keeps who holds the password server-only: by, authOwner and adminPasswordAt, from an admin or the person (RF4)', async () => {
        await assertFails(updateDoc(doc(admin(), 'users', 'alice-doc'), { by: 'admin' }));
        await assertFails(updateDoc(doc(admin(), 'users', 'alice-doc'), { authOwner: 'arccms' }));
        await assertFails(updateDoc(doc(admin(), 'users', 'alice-doc'), { adminPasswordAt: new Date() }));
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { adminPasswordAt: new Date() }));
    });

    it('lets an admin edit the rest of a record, writing the same role and block back included', async () => {
        await assertSucceeds(updateDoc(doc(admin(), 'users', 'alice-doc'), { name: 'Alice A', role: 'user', isActive: true, status: 'Active' }));
    });
});

describe('users: read', () => {
    it('lets a user read their own doc, by id and by uid query', async () => {
        await assertSucceeds(getDoc(doc(alice(), 'users', 'alice-doc')));
        await assertSucceeds(getDocs(query(collection(alice(), 'users'), where('uid', '==', ALICE))));
    });

    it("refuses reading someone else's doc", async () => {
        await assertFails(getDoc(doc(alice(), 'users', 'bob-doc')));
    });

    it('refuses listing every user', async () => {
        await assertFails(getDocs(collection(alice(), 'users')));
    });

    it('lets an admin list users', async () => {
        await assertSucceeds(getDocs(collection(admin(), 'users')));
    });

    it('does not let a user delete any user doc', async () => {
        await assertFails(deleteDoc(doc(alice(), 'users', 'alice-doc')));
    });

    it('does not let an admin delete one either: Users deletes through adminDeleteUser (RF4)', async () => {
        await assertFails(deleteDoc(doc(admin(), 'users', 'bob-doc')));
    });
});

describe('first-admin sentinel', () => {
    it('is closed to every client, admins included', async () => {
        await assertFails(getDoc(doc(admin(), '_system', 'first_admin')));
        await assertFails(deleteDoc(doc(admin(), '_system', 'first_admin')));
        await assertFails(setDoc(doc(alice(), '_system', 'first_admin'), { uid: ALICE }));
    });
});

describe('Settings/users (holds defaultRole)', () => {
    it('refuses writes from a signed-in non-admin', async () => {
        await assertFails(setDoc(doc(alice(), 'Settings', 'users'), { defaultRole: 'admin' }));
    });

    it('stays public read and admin write', async () => {
        await assertSucceeds(getDoc(doc(anon(), 'Settings', 'users')));
        await assertSucceeds(setDoc(doc(admin(), 'Settings', 'users'), { defaultRole: 'user', isSignupEnabled: true }));
    });
});

describe('site settings and email_lookup are admin write only (review S5)', () => {
    const PUBLIC_READ = ['about', 'email_status', 'global-message', 'misc', 'site-usage', 'onboarding_status'];
    const ALL = [...PUBLIC_READ, 'site'];

    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'email_lookup', 'hash-a'), { exists: true });
        });
    });

    it('refuses a signed-in member and a host app\'s admin', async () => {
        for (const db of [alice(), hostAdmin()]) {
            for (const id of ALL) {
                await assertFails(setDoc(doc(db, 'Settings', id), { x: 1 }, { merge: true }));
            }
            await assertFails(setDoc(doc(db, 'email_lookup', 'hash-b'), { exists: true }));
            await assertFails(deleteDoc(doc(db, 'email_lookup', 'hash-a')));
        }
    });

    it('lets an admin write them', async () => {
        for (const id of ALL) await assertSucceeds(setDoc(doc(admin(), 'Settings', id), { x: 1 }, { merge: true }));
        await assertSucceeds(deleteDoc(doc(admin(), 'email_lookup', 'hash-a')));
    });

    it('keeps the public reads, and Settings/site admin read', async () => {
        for (const id of PUBLIC_READ) await assertSucceeds(getDoc(doc(anon(), 'Settings', id)));
        await assertSucceeds(getDoc(doc(anon(), 'email_lookup', 'hash-a')));
        await assertFails(getDoc(doc(alice(), 'Settings', 'site')));
        await assertSucceeds(getDoc(doc(admin(), 'Settings', 'site')));
    });

    // A list handed anyone every hash, which a dictionary of addresses turns back into addresses.
    it('lets anyone check one address in email_lookup, and only admins list it once setup has started', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'Settings', 'onboarding_status'), { completed: true });
        });
        for (const db of [anon(), alice(), hostAdmin()]) {
            await assertFails(getDocs(collection(db, 'email_lookup')));
            await assertFails(getDocs(query(collection(db, 'email_lookup'), limit(1))));
        }
        await assertSucceeds(getDocs(collection(admin(), 'email_lookup')));
    });

    // A fresh install asks "is this the first run?" by listing (AuthService.isFirstRun).
    it('lets anyone list email_lookup on a fresh install, before setup has started', async () => {
        await assertSucceeds(getDocs(query(collection(anon(), 'email_lookup'), limit(1))));
    });

    // An app whose members sign up without the setup wizard never writes onboarding_status;
    // its first member's record writes _system/has_members (onUserCreated).
    it('closes the list once the install has members, even with no setup wizard', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), '_system', 'has_members'), { since: new Date() });
        });
        for (const db of [anon(), alice()]) {
            await assertFails(getDocs(query(collection(db, 'email_lookup'), limit(1))));
        }
        await assertSucceeds(getDoc(doc(anon(), 'email_lookup', 'hash-a')));
        await assertSucceeds(getDocs(collection(admin(), 'email_lookup')));
    });

    it('keeps Settings/analytics_status admin only', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'Settings', 'analytics_status'), { isConnected: true, propertyName: 'Site' });
        });
        await assertFails(getDoc(doc(anon(), 'Settings', 'analytics_status')));
        await assertFails(getDoc(doc(alice(), 'Settings', 'analytics_status')));
        await assertSucceeds(getDoc(doc(admin(), 'Settings', 'analytics_status')));
        await assertFails(setDoc(doc(alice(), 'Settings', 'analytics_status'), { isConnected: false }));
    });
});

describe('content writes are staff only', () => {
    const writes = (db: ReturnType<typeof alice>) => [
        () => setDoc(doc(db, 'ContentTypes', 'articles'), { slug: 'articles', name: 'x' }),
        () => setDoc(doc(db, 'arc_articles', 'p1'), { title: 'x' }),
        () => setDoc(doc(db, 'arc_articles_drafts', 'd1'), { title: 'x' }),
        () => setDoc(doc(db, 'arc_articles_drafts', 'd1', 'translations', 'fr'), { title: 'x' }),
        () => setDoc(doc(db, 'Tags_articles', 't1'), { name: 'x' }),
        () => setDoc(doc(db, 'media', 'm1'), { downloadURL: 'x' }),
        () => setDoc(doc(db, 'mediaFiles', 'f1'), { downloadURL: 'x', title: 'Price list' }),
        () => addDoc(collection(db, '_publish_queue'), { action: 'publish', contentTypeSlug: 'articles', docId: 'p1', timestamp: new Date() }),
        () => setDoc(doc(db, '_search_queue', 'arc_articles_drafts~d1'), { collection: 'arc_articles_drafts', docId: 'd1', at: new Date() }),
    ];

    it('refuses a signed-in non-staff user', async () => {
        for (const write of writes(alice())) await assertFails(write());
    });

    it('allows an admin', async () => {
        for (const write of writes(admin())) await assertSucceeds(write());
    });

    it('allows an editor', async () => {
        for (const write of writes(editor())) await assertSucceeds(write());
    });

    it('refuses a plain `role` claim, which a host app may set (CO-D7)', async () => {
        for (const write of writes(hostAdmin())) await assertFails(write());
        await assertFails(getDoc(doc(hostAdmin(), 'arc_articles_drafts', 'd1')));
        await assertFails(getDocs(collection(hostAdmin(), 'users')));
        await assertFails(setDoc(doc(hostAdmin(), 'Settings', 'users'), { defaultRole: 'admin' }));
    });

    it('lets the search queue hold only a draft to index, and nobody read it', async () => {
        const queue = (fields: Record<string, unknown>) => setDoc(doc(admin(), '_search_queue', 'q1'), fields);
        await assertFails(queue({ collection: 'users', docId: 'u1' }));
        await assertFails(queue({ collection: 'arc_articles_drafts', docId: 'd1', note: 'x' }));
        await assertFails(getDoc(doc(admin(), '_search_queue', 'q1')));
    });

    it('keeps drafts away from non-staff readers', async () => {
        await assertFails(getDoc(doc(alice(), 'arc_articles_drafts', 'd1')));
        await assertSucceeds(getDoc(doc(admin(), 'arc_articles_drafts', 'd1')));
    });

    it('keeps published content, tags and content types public', async () => {
        await assertSucceeds(getDoc(doc(anon(), 'arc_articles', 'p1')));
        await assertSucceeds(getDoc(doc(anon(), 'Tags_articles', 't1')));
        await assertSucceeds(getDoc(doc(anon(), 'ContentTypes', 'articles')));
    });
});

describe('phone and email sign-in fields (item 1: Google and phone sign-in)', () => {
    it('refuses a self-created record that claims a phone number', async () => {
        await assertFails(addDoc(collection(alice(), 'users'), { uid: ALICE, email: 'a2@x.com', phone: '+919876543210' }));
        await assertFails(addDoc(collection(alice(), 'users'), { uid: ALICE, email: 'a2@x.com', phoneVerified: true }));
    });

    it('refuses changing your own email or phone directly (they go through a code)', async () => {
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { email: 'new@x.com' }));
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { phone: '+919876543210' }));
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { phoneVerified: true }));
    });

    it('still lets you change your name', async () => {
        await assertSucceeds(updateDoc(doc(alice(), 'users', 'alice-doc'), { name: 'Alice B' }));
    });

    it('lets an admin set the email, but the number only through adminSetPhone, which checks it (RF4)', async () => {
        await assertSucceeds(updateDoc(doc(admin(), 'users', 'alice-doc'), { email: 'new@x.com' }));
        await assertFails(updateDoc(doc(admin(), 'users', 'alice-doc'), { phone: '+919876543210' }));
        await assertFails(updateDoc(doc(admin(), 'users', 'alice-doc'), { phoneVerified: true }));
    });

    it('keeps codes, PINs, the number index and rate limits closed to everyone', async () => {
        for (const name of ['phone_otps', 'phone_index', 'auth_pins', 'app_pins', 'app_phone_pin_tries', 'auth_devices', 'auth_fresh_proofs', 'app_member_pin_tries', '_rate_limits']) {
            await assertFails(getDoc(doc(anon(), name, 'x')));
            await assertFails(getDoc(doc(alice(), name, 'x')));
            await assertFails(getDoc(doc(admin(), name, 'x')));
            await assertFails(setDoc(doc(admin(), name, 'x'), { a: 1 }));
        }
    });

    it('lets admins read SMS logs, account transfers and install counters, and nobody write them', async () => {
        for (const name of ['SmsLogs', 'account_transfers', 'PwaStats']) {
            await assertSucceeds(getDoc(doc(admin(), name, 'x')));
            await assertFails(getDoc(doc(alice(), name, 'x')));
            await assertFails(setDoc(doc(admin(), name, 'x'), { a: 1 }));
        }
    });

    it('lets admins read AI records and totals, and nobody write them', async () => {
        for (const path of [['AiCalls', 'c1'], ['AiCalls', 'c1', 'content', 'main'], ['AiUsage', '2026-10'], ['AiUsage', '2026-10', 'keys', 'menu-scan__k'], ['AiUsage', '2026-10', 'days', '28__menu-scan__k']]) {
            await assertSucceeds(getDoc(doc(admin(), path.join('/'))));
            await assertFails(getDoc(doc(alice(), path.join('/'))));
            await assertFails(setDoc(doc(admin(), path.join('/')), { a: 1 }));
        }
    });

    it('keeps AI keys from every browser, admins included', async () => {
        await assertFails(getDoc(doc(admin(), 'AiKeys', 'qwen')));
        await assertFails(setDoc(doc(admin(), 'AiKeys', 'qwen'), { key: 'sk-12345678' }));
        await assertFails(getDoc(doc(alice(), 'AiKeys', 'qwen')));
        await assertFails(getDoc(doc(anon(), 'AiKeys', 'qwen')));
    });

    it('keeps merchants\' provider keys, webhook addresses, events and the pretend records from every browser, admins included', async () => {
        for (const c of ['MerchantAccountKeys', 'MerchantWebhooks', 'MerchantPaymentEvents', 'MerchantPretendPayments']) {
            await assertFails(getDoc(doc(admin(), c, 'x')));
            await assertFails(setDoc(doc(admin(), c, 'x'), { a: 1 }));
            await assertFails(getDoc(doc(alice(), c, 'x')));
            await assertFails(getDoc(doc(anon(), c, 'x')));
        }
    });

    it('lets admins read a merchant\'s public account and payments; only the functions write them', async () => {
        for (const c of ['MerchantAccounts', 'MerchantPayments']) {
            await assertSucceeds(getDoc(doc(admin(), c, 'x')));
            await assertFails(setDoc(doc(admin(), c, 'x'), { status: 'paid' }));
            await assertFails(getDoc(doc(alice(), c, 'x')));
            await assertFails(setDoc(doc(alice(), c, 'x'), { status: 'paid' }));
            await assertFails(getDoc(doc(anon(), c, 'x')));
        }
    });

    it('keeps the AI cache and pacing counters from every browser, admins included', async () => {
        for (const [c, id] of [['AiCache', 'abc'], ['AiPacing', 'sarvam']]) {
            await assertFails(getDoc(doc(admin(), c, id)));
            await assertFails(setDoc(doc(admin(), c, id), { a: 1 }));
            await assertFails(getDoc(doc(alice(), c, id)));
        }
    });

    it('lets admins and a job\'s readers read a long AI job, and nobody write one', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'AiJobs', 'j1'), { status: 'pending', readers: ['user-alice'] });
            await setDoc(doc(ctx.firestore(), 'AiJobs', 'j2'), { status: 'pending', readers: [] });
        });
        const reader = () => env.authenticatedContext('alice-auth', { arccms_uid: 'user-alice' }).firestore();
        const other = () => env.authenticatedContext('bob-auth', { arccms_uid: 'user-bob' }).firestore();
        await assertSucceeds(getDoc(doc(admin(), 'AiJobs', 'j1')));
        await assertSucceeds(getDoc(doc(reader(), 'AiJobs', 'j1')));
        await assertFails(getDoc(doc(reader(), 'AiJobs', 'j2')));
        await assertFails(getDoc(doc(other(), 'AiJobs', 'j1')));
        await assertFails(getDoc(doc(anon(), 'AiJobs', 'j1')));
        await assertFails(setDoc(doc(admin(), 'AiJobs', 'j1'), { status: 'done' }));
        await assertFails(setDoc(doc(reader(), 'AiJobs', 'j1'), { status: 'done' }));
    });

    it('keeps Settings/ai admin only', async () => {
        await assertFails(getDoc(doc(alice(), 'Settings', 'ai')));
        await assertFails(getDoc(doc(anon(), 'Settings', 'ai')));
        await assertSucceeds(setDoc(doc(admin(), 'Settings', 'ai'), { mode: 'test' }));
    });

    it('keeps Settings/sms (the MSG91 key) admin only', async () => {
        await assertFails(getDoc(doc(alice(), 'Settings', 'sms')));
        await assertFails(getDoc(doc(anon(), 'Settings', 'sms')));
        await assertSucceeds(setDoc(doc(admin(), 'Settings', 'sms'), { provider: 'log' }));
    });
});

describe('data under a users record (docs/app/account-contract.html)', () => {
    it('is closed until an app rule opens it, even to the owner', async () => {
        const owner = env.authenticatedContext(ALICE, { arccms_uid: 'alice-doc' }).firestore();
        await assertFails(setDoc(doc(owner, 'users', 'alice-doc', 'children', 'c1'), { name: 'Kid' }));
        await assertFails(getDoc(doc(owner, 'users', 'alice-doc', 'children', 'c1')));
    });

    it('lets the owner read their record by id, as the claim points to it', async () => {
        const owner = env.authenticatedContext(ALICE, { arccms_uid: 'alice-doc' }).firestore();
        await assertSucceeds(getDoc(doc(owner, 'users', 'alice-doc')));
    });
});

// SS5 (specs/site-sections-spec.md): only the function writes contact messages.
describe('claims leases (functions/src/users/claimLock.ts)', () => {
    it('keeps _claim_locks closed to everyone, admins included', async () => {
        await assertFails(getDoc(doc(anon(), '_claim_locks', 'x')));
        await assertFails(getDoc(doc(alice(), '_claim_locks', ALICE)));
        await assertFails(getDoc(doc(admin(), '_claim_locks', 'x')));
        await assertFails(setDoc(doc(alice(), '_claim_locks', ALICE), { token: 't', expiresAt: 0 }));
        await assertFails(setDoc(doc(admin(), '_claim_locks', 'x'), { token: 't', expiresAt: 0 }));
    });
});

// What the admin app writes (PublishQueueService), and nothing else: a coalesced
// item (functions/src/publishQueue/coalesced-items.ts) is the functions' own.
describe('publish queue (functions/src/publishQueue/processPublishQueue.ts)', () => {
    const item = (fields: Record<string, unknown> = {}) => ({ action: 'publish', contentTypeSlug: 'articles', docId: 'p1', timestamp: new Date(), ...fields });

    it('lets staff add each item the admin app sends', async () => {
        for (const action of ['publish', 'unpublish', 'update', 'delete', 'redeploy']) {
            await assertSucceeds(addDoc(collection(editor(), '_publish_queue'), item({ action })));
        }
        await assertSucceeds(addDoc(collection(editor(), '_publish_queue'), item({ action: 'redeploy-all', contentTypeSlug: '', docId: '' })));
        await assertSucceeds(addDoc(collection(admin(), '_publish_queue'), item({ action: 'order', docId: '' })));
    });

    it('refuses a coalesced item\'s fixed id, such as a forged running republish', async () => {
        const forged = { ...item({ action: 'redeploy-all', contentTypeSlug: '', docId: '' }) };
        await assertFails(setDoc(doc(editor(), '_publish_queue', 'redeploy-all'), forged));
        await assertFails(setDoc(doc(admin(), '_publish_queue', 'redeploy-all'), forged));
        await assertFails(setDoc(doc(editor(), '_publish_queue', 'items-from--articles'), item({ action: 'publish' })));
    });

    it('refuses other fields, missing fields, wrong types and actions the app never sends', async () => {
        const add = (fields: Record<string, unknown>) => addDoc(collection(editor(), '_publish_queue'), fields);
        await assertFails(add(item({ state: 'running', since: Date.now() + 1e12 })));
        await assertFails(add(item({ coalesced: true })));
        await assertFails(add({ action: 'publish', contentTypeSlug: 'articles', docId: 'p1' }));
        await assertFails(add(item({ action: 'items-from' })));
        await assertFails(add(item({ action: 'home' })));
        await assertFails(add(item({ docId: 7 })));
        await assertFails(add(item({ timestamp: 'now' })));
    });

    it('lets nobody read, change or delete a queue item', async () => {
        await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), '_publish_queue', 'q1'), item()));
        await assertFails(getDoc(doc(admin(), '_publish_queue', 'q1')));
        await assertFails(getDocs(query(collection(editor(), '_publish_queue'), where('docId', '==', 'p1'))));
        await assertFails(updateDoc(doc(admin(), '_publish_queue', 'q1'), { action: 'delete' }));
        await assertFails(setDoc(doc(editor(), '_publish_queue', 'q1'), item({ action: 'delete' })));
        await assertFails(deleteDoc(doc(editor(), '_publish_queue', 'q1')));
    });
});

describe('Hosting release lock (functions/src/pages/hosting-release-lock.ts)', () => {
    it('keeps _hosting_releases closed to everyone, admins included', async () => {
        await assertFails(getDoc(doc(anon(), '_hosting_releases', 'site')));
        await assertFails(getDoc(doc(admin(), '_hosting_releases', 'site~lock')));
        await assertFails(setDoc(doc(alice(), '_hosting_releases', 'site~lock'), { holder: 'h', since: 0 }));
        await assertFails(setDoc(doc(admin(), '_hosting_releases', 'site'), { version: 'v', releaseTime: '' }));
    });
});

describe('contact messages', () => {
    const message = { name: 'Asha', email: 'asha@example.com', message: 'Hello', status: 'new', createdAt: serverTimestamp() };
    beforeEach(() => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'ContactMessages', 'm1'), message)));

    it('cannot be written from a browser, signed in or not, admin or not', async () => {
        await assertFails(setDoc(doc(anon(), 'ContactMessages', 'm2'), message));
        await assertFails(addDoc(collection(alice(), 'ContactMessages'), message));
        await assertFails(setDoc(doc(admin(), 'ContactMessages', 'm2'), message));
    });

    it('is read, deleted and marked done or spam by admins only', async () => {
        await assertFails(getDoc(doc(anon(), 'ContactMessages', 'm1')));
        await assertFails(getDoc(doc(alice(), 'ContactMessages', 'm1')));
        await assertFails(getDoc(doc(editor(), 'ContactMessages', 'm1')));
        await assertSucceeds(getDoc(doc(admin(), 'ContactMessages', 'm1')));
        await assertSucceeds(updateDoc(doc(admin(), 'ContactMessages', 'm1'), { status: 'done' }));
        await assertSucceeds(updateDoc(doc(admin(), 'ContactMessages', 'm1'), { status: 'spam' }));
        await assertFails(updateDoc(doc(alice(), 'ContactMessages', 'm1'), { status: 'done' }));
        await assertSucceeds(deleteDoc(doc(admin(), 'ContactMessages', 'm1')));
    });

    it('lets an admin change the status only, to a known one', async () => {
        await assertFails(updateDoc(doc(admin(), 'ContactMessages', 'm1'), { message: 'Edited' }));
        await assertFails(updateDoc(doc(admin(), 'ContactMessages', 'm1'), { status: 'archived' }));
    });
});

describe('feedback (docs/features/feedback.html)', () => {
    const sender = () => env.authenticatedContext(ALICE, { arccms_uid: 'alice-doc' }).firestore();
    const noRecord = () => env.authenticatedContext(ALICE).firestore();
    const feedback = (extra: Record<string, unknown> = {}) => ({
        uid: ALICE, userDocId: 'alice-doc', message: 'The lesson froze',
        page: { path: '/learn', title: 'Learn' }, device: { platform: 'android' },
        status: 'new', createdAt: serverTimestamp(), ...extra,
    });
    beforeEach(() => env.withSecurityRulesDisabled((ctx) =>
        setDoc(doc(ctx.firestore(), 'Settings', 'feedback'), { enabled: true })));

    it('refuses feedback while the button is off, and odd page or device details (review F)', async () => {
        await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'Settings', 'feedback'), { enabled: false }));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f1'), feedback()));
        await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'Settings', 'feedback'), { enabled: true }));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ device: { userAgent: 1 } })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ device: { platform: 'android', blob: 'x'.repeat(10) } })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ page: { path: 'x'.repeat(600) } })));
        await assertSucceeds(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ device: { platform: 'android', installed: true, userAgent: 'UA' } })));
    });

    it('takes the build the person is on, and nothing else in it (specs/app-version-spec.md AV-D10)', async () => {
        await assertSucceeds(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ version: { text: 'v1.2.0.25 android', commit: '533b6d02+changes' } })));
        await assertSucceeds(setDoc(doc(sender(), 'Feedback', 'f2'), feedback({ version: { text: 'v1.2.0', commit: '' } })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f3'), feedback({ version: 'v1.2.0' })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f3'), feedback({ version: { text: 'x'.repeat(101) } })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f3'), feedback({ version: { text: 'v1.2.0', commit: 'x'.repeat(25) } })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f3'), feedback({ version: { text: 'v1.2.0', admin: true } })));
    });


    it('lets a signed-in person send their own, with files from their own folder', async () => {
        await assertSucceeds(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({
            screenshotPath: 'arccms/users/alice-doc/feedback/f1/screenshot.jpg',
            voicePath: 'users/alice-doc/feedback/f1/voice.mp4', voiceSeconds: 12,
        })));
        await assertSucceeds(setDoc(doc(sender(), 'Feedback', 'f2'), feedback({ message: '', voicePath: 'users/alice-doc/feedback/f2/voice.webm' })));
    });

    it('refuses someone else\'s, a record-less sign-in, an empty one, or another folder', async () => {
        await assertFails(setDoc(doc(anon(), 'Feedback', 'f1'), feedback()));
        await assertFails(setDoc(doc(noRecord(), 'Feedback', 'f1'), feedback()));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ userDocId: 'bob-doc' })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ message: '' })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ status: 'done' })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ sender: { name: 'The admin' } })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ screenshotPath: 'users/bob-doc/feedback/f1/screenshot.jpg' })));
        // Review F: an id that is a pattern (`x|.*`) once matched any path, and the
        // admin's Delete then deleted that file.
        await assertFails(setDoc(doc(sender(), 'Feedback', 'x|.*'), feedback({ screenshotPath: 'arccms/mediaImages/logo.png' })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ screenshotPath: 'arccms/users/alice-doc/feedback/f1/logo.svg' })));
        await assertFails(setDoc(doc(sender(), 'Feedback', 'f1'), feedback({ voicePath: 'a/b/users/alice-doc/feedback/f1/voice.mp4' })));
    });

    it('is read, updated and deleted by admins only', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'Feedback', 'f1'), { uid: ALICE, userDocId: 'alice-doc', status: 'new' });
        });
        await assertFails(getDoc(doc(sender(), 'Feedback', 'f1')));
        await assertFails(updateDoc(doc(sender(), 'Feedback', 'f1'), { status: 'done' }));
        await assertSucceeds(getDoc(doc(admin(), 'Feedback', 'f1')));
        await assertSucceeds(updateDoc(doc(admin(), 'Feedback', 'f1'), { status: 'done' }));
        await assertSucceeds(deleteDoc(doc(admin(), 'Feedback', 'f1')));
    });

    it('lets anyone see whether the button is on, and only admins switch it', async () => {
        await assertSucceeds(getDoc(doc(anon(), 'Settings', 'feedback')));
        await assertFails(setDoc(doc(sender(), 'Settings', 'feedback'), { enabled: true }));
        await assertSucceeds(setDoc(doc(admin(), 'Settings', 'feedback'), { enabled: true }));
    });
});

describe('app accounts: no email, no phone (docs/app/app-accounts.html)', () => {
    const STAFF = 'staff-uid';
    const staff = () => env.authenticatedContext(STAFF, { arccms_uid: 'staff-doc', arccms_role: 'user', site: 's-1' }).firestore();

    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'users', 'staff-doc'), {
                id: 'staff-doc', uid: STAFF, name: 'Anna', email: '', phone: '', emailVerified: false, phoneVerified: false,
                role: 'user', status: 'Active', isActive: true, by: 'app',
            });
        });
    });

    it('lets the person read their own record, and nobody else\'s', async () => {
        await assertSucceeds(getDoc(doc(staff(), 'users', 'staff-doc')));
        await assertFails(getDoc(doc(staff(), 'users', 'alice-doc')));
    });

    it('never lets them make themselves an admin, or add an email or phone from the browser', async () => {
        await assertFails(updateDoc(doc(staff(), 'users', 'staff-doc'), { role: 'admin' }));
        await assertFails(updateDoc(doc(staff(), 'users', 'staff-doc'), { email: 'anna@x.com' }));
        await assertFails(updateDoc(doc(staff(), 'users', 'staff-doc'), { phone: '+15550100' }));
    });

    it('cannot be created from the browser: only the server makes them', async () => {
        await assertFails(setDoc(doc(staff(), 'users', 'staff-2'), { uid: 'other', name: 'Ben', email: '', phone: '', role: 'user', by: 'app' }));
    });
});

describe('app accounts are locked (docs/app/app-accounts.html)', () => {
    const LOCKED = 'locked-uid';
    const OPEN = 'open-uid';
    const locked = () => env.authenticatedContext(LOCKED, { arccms_uid: 'locked-doc', arccms_role: 'user' }).firestore();
    const open = () => env.authenticatedContext(OPEN, { arccms_uid: 'open-doc', arccms_role: 'user' }).firestore();
    const record = (uid: string, extra: Record<string, unknown>) => ({
        uid, name: 'Anna', photo: '', email: '', phone: '', emailVerified: false, phoneVerified: false,
        role: 'user', status: 'Active', isActive: true, by: 'app', preferredLanguage: 'en', ...extra,
    });

    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            // Made before the lock existed: no selfService field, so locked.
            await setDoc(doc(ctx.firestore(), 'users', 'locked-doc'), record(LOCKED, {}));
            await setDoc(doc(ctx.firestore(), 'users', 'open-doc'), record(OPEN, { selfService: true }));
        });
    });

    it('never lets a locked account change its name, photo or sign-in fields', async () => {
        const mine = doc(locked(), 'users', 'locked-doc');
        await assertFails(updateDoc(mine, { name: 'Someone else' }));
        await assertFails(updateDoc(mine, { photo: 'https://example.com/me.png' }));
        await assertFails(updateDoc(mine, { emailVerified: false, name: 'X' }));
        await assertFails(updateDoc(mine, { email: 'anna@x.com' }));
        await assertFails(updateDoc(mine, { phone: '+15550100', phoneVerified: true }));
    });

    it('never lets a locked account unlock itself, or change who made it', async () => {
        const mine = doc(locked(), 'users', 'locked-doc');
        await assertFails(updateDoc(mine, { selfService: true }));
        await assertFails(updateDoc(mine, { by: 'email' }));
        await assertFails(updateDoc(mine, { by: 'email', name: 'Anna B' }));
    });

    it('still lets a locked account change what is not its identity', async () => {
        await assertSucceeds(updateDoc(doc(locked(), 'users', 'locked-doc'), { preferredLanguage: 'hi' }));
    });

    it('lets an account made with selfService: true change itself like any member', async () => {
        const mine = doc(open(), 'users', 'open-doc');
        await assertSucceeds(updateDoc(mine, { name: 'Anna B' }));
        await assertSucceeds(updateDoc(mine, { photo: 'https://example.com/me.png' }));
        // The lock flag and `by` stay out of reach for it too.
        await assertFails(updateDoc(mine, { selfService: false }));
        await assertFails(updateDoc(mine, { by: 'email' }));
    });

    it('leaves ordinary accounts as they were, except that `by` and `selfService` are the server\'s', async () => {
        const mine = doc(alice(), 'users', 'alice-doc');
        await assertSucceeds(updateDoc(mine, { name: 'Alice B' }));
        await assertSucceeds(updateDoc(mine, { photo: 'https://example.com/a.png' }));
        await assertFails(updateDoc(mine, { by: 'app' }));
        await assertFails(updateDoc(mine, { selfService: true }));
    });

    it('lets an admin change a locked account', async () => {
        await assertSucceeds(updateDoc(doc(admin(), 'users', 'locked-doc'), { name: 'Anna B', selfService: true }));
    });
});

describe('media library details are staff only (MF-D24)', () => {
    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'media', 'm1'), { downloadURL: 'x', notes: 'staff note' });
            await setDoc(doc(ctx.firestore(), 'mediaFiles', 'f1'), { downloadURL: 'x', notes: 'staff note' });
        });
    });

    it('refuses a visitor and a member', async () => {
        await assertFails(getDoc(doc(anon(), 'media', 'm1')));
        await assertFails(getDoc(doc(anon(), 'mediaFiles', 'f1')));
        await assertFails(getDoc(doc(alice(), 'media', 'm1')));
        await assertFails(getDoc(doc(alice(), 'mediaFiles', 'f1')));
    });

    it('lets staff read', async () => {
        await assertSucceeds(getDoc(doc(admin(), 'media', 'm1')));
        await assertSucceeds(getDoc(doc(admin(), 'mediaFiles', 'f1')));
    });
});

// specs/form-gamification-spec.md: signup forms are plain, joined through Cloud Functions.
describe('signup forms', () => {
    const member = 'Waitlists/launch/users/m1';
    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            await setDoc(doc(db, 'Waitlists', 'launch'), { name: 'Launch', totalSignups: 3, isActive: true });
            await setDoc(doc(db, member), { email: 'm@x.com', waitlistId: 'launch', firstName: 'M', isSubscribed: true });
            await setDoc(doc(db, member, 'referrals', 'r1'), { referredEmail: 'friend@x.com', status: 'completed' });
        });
    });

    it('keeps the form public to read, and admin only to write, its signup count included', async () => {
        await assertSucceeds(getDoc(doc(anon(), 'Waitlists', 'launch')));
        await assertFails(updateDoc(doc(anon(), 'Waitlists', 'launch'), { totalSignups: 9999 }));
        await assertFails(updateDoc(doc(alice(), 'Waitlists', 'launch'), { totalSignups: 9999 }));
        await assertSucceeds(updateDoc(doc(admin(), 'Waitlists', 'launch'), { totalSignups: 4 }));
    });

    it('never lets a visitor read a member, or write a referral field onto one', async () => {
        await assertFails(getDoc(doc(anon(), member)));
        await assertFails(updateDoc(doc(anon(), member), { leaderboardLink: 'https://evil.example' }));
        await assertFails(updateDoc(doc(anon(), member), { referredBy: 'CODE1' }));
        await assertFails(updateDoc(doc(anon(), member), { queuePosition: 1 }));
    });

    // Joining, confirming and unsubscribing all run in Cloud Functions.
    it('lets only admins add, change or remove a member', async () => {
        for (const db of [anon(), alice(), hostAdmin()]) {
            await assertFails(updateDoc(doc(db, member), { isSubscribed: false }));
            await assertFails(updateDoc(doc(db, member), { firstName: 'X', tags: ['vip'] }));
            await assertFails(setDoc(doc(db, 'Waitlists/launch/users/m2'), { email: 'n@x.com', waitlistId: 'launch' }));
            await assertFails(addDoc(collection(db, 'Waitlists/launch/users'), { email: 'n@x.com', waitlistId: 'launch' }));
            await assertFails(deleteDoc(doc(db, member)));
        }
        await assertSucceeds(updateDoc(doc(admin(), member), { isSubscribed: false, tags: ['vip'] }));
        await assertSucceeds(setDoc(doc(admin(), 'Waitlists/launch/users/m2'), { email: 'n@x.com', waitlistId: 'launch' }));
        await assertSucceeds(deleteDoc(doc(admin(), member)));
    });

    it("keeps a form's member tags admin only, their use count included", async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'WaitlistUserTags_launch', 'vip'), { label: 'VIP', usageCount: 2 });
        });
        for (const db of [anon(), alice()]) {
            await assertFails(updateDoc(doc(db, 'WaitlistUserTags_launch', 'vip'), { usageCount: 3 }));
            await assertFails(getDoc(doc(db, 'WaitlistUserTags_launch', 'vip')));
            await assertFails(setDoc(doc(db, 'WaitlistUserTags_launch', 'new'), { label: 'New', usageCount: 0 }));
        }
        await assertSucceeds(updateDoc(doc(admin(), 'WaitlistUserTags_launch', 'vip'), { usageCount: 3 }));
        await assertSucceeds(getDoc(doc(admin(), 'WaitlistUserTags_launch', 'vip')));
    });

    it('closes the old referrals records to every client, admins included', async () => {
        const referrals = collection(anon(), member, 'referrals');
        await assertFails(addDoc(referrals, { referredEmail: 'x@y.com' }));
        await assertFails(getDoc(doc(admin(), member, 'referrals', 'r1')));
        await assertFails(updateDoc(doc(anon(), member, 'referrals', 'r1'), { status: 'pending' }));
        await assertFails(deleteDoc(doc(admin(), member, 'referrals', 'r1')));
        // The retired registry's records too.
        await assertFails(addDoc(collection(anon(), 'WaitlistedUsers', 'w1', 'referrals'), { referredEmail: 'x@y.com' }));
        await assertFails(getDoc(doc(admin(), 'WaitlistedUsers', 'w1', 'referrals', 'r1')));
    });
});

describe('products and their discount codes', () => {
    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            await setDoc(doc(db, 'Products', 'on'), { name: 'Gold', active: true, tiers: [{ label: 'Early', maxCount: 10 }] });
            await setDoc(doc(db, 'Products', 'off'), { name: 'Old', active: false });
            await setDoc(doc(db, 'Products', 'unset'), { name: 'Draft' });
            await setDoc(doc(db, 'ProductCodes', 'on'), { discountCodes: ['EARLY'] });
        });
    });

    it('shows a visitor and a member active products only, and lists them only when asked for active ones', async () => {
        for (const db of [anon(), alice()]) {
            await assertSucceeds(getDoc(doc(db, 'Products', 'on')));
            await assertFails(getDoc(doc(db, 'Products', 'off')));
            await assertFails(getDoc(doc(db, 'Products', 'unset')));
            await assertSucceeds(getDocs(query(collection(db, 'Products'), where('active', '==', true))));
            await assertFails(getDocs(collection(db, 'Products')));
        }
    });

    it('lets an admin read and list every product, and nobody else write one', async () => {
        await assertSucceeds(getDoc(doc(admin(), 'Products', 'off')));
        await assertSucceeds(getDocs(collection(admin(), 'Products')));
        await assertSucceeds(updateDoc(doc(admin(), 'Products', 'on'), { name: 'Gold+' }));
        for (const db of [anon(), alice(), hostAdmin()]) {
            await assertFails(updateDoc(doc(db, 'Products', 'on'), { purchaseCount: 0 }));
            await assertFails(setDoc(doc(db, 'Products', 'new'), { name: 'Free', active: true }));
        }
    });

    it('keeps the tier codes admin only', async () => {
        for (const db of [anon(), alice(), hostAdmin(), editor()]) {
            await assertFails(getDoc(doc(db, 'ProductCodes', 'on')));
            await assertFails(getDocs(collection(db, 'ProductCodes')));
            await assertFails(setDoc(doc(db, 'ProductCodes', 'on'), { discountCodes: ['FREE'] }));
        }
        await assertSucceeds(getDocs(collection(admin(), 'ProductCodes')));
        await assertSucceeds(setDoc(doc(admin(), 'ProductCodes', 'on'), { discountCodes: ['EARLY2'] }));
        await assertSucceeds(deleteDoc(doc(admin(), 'ProductCodes', 'on')));
    });

    it('keeps admin test checkout tokens from every browser, admins included', async () => {
        for (const db of [anon(), alice(), admin()]) {
            await assertFails(getDoc(doc(db, 'TestCheckouts', 't_x')));
            await assertFails(setDoc(doc(db, 'TestCheckouts', 't_x'), { productId: 'on' }));
        }
    });
});

describe('payments, credits and notifications belong to their owner', () => {
    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            await setDoc(doc(db, 'Transactions', 'tA'), { userId: ALICE, amount: 10 });
            await setDoc(doc(db, 'Transactions', 'tB'), { userId: BOB, amount: 20 });
            await setDoc(doc(db, 'CreditLedger', 'cA'), { userId: ALICE, delta: 5 });
            await setDoc(doc(db, 'CreditLedger', 'cB'), { userId: BOB, delta: 5 });
            await setDoc(doc(db, 'Notifications', 'nA'), { userId: ALICE, title: 'Hi', read: false });
            await setDoc(doc(db, 'Notifications', 'nB'), { userId: BOB, title: 'Hi', read: false });
        });
    });

    it('lets a member read their own transactions and credit entries, and nobody write them', async () => {
        for (const name of ['Transactions', 'CreditLedger']) {
            const [mine, theirs] = name === 'Transactions' ? ['tA', 'tB'] : ['cA', 'cB'];
            await assertSucceeds(getDoc(doc(alice(), name, mine)));
            await assertSucceeds(getDocs(query(collection(alice(), name), where('userId', '==', ALICE))));
            await assertFails(getDoc(doc(alice(), name, theirs)));
            await assertFails(getDocs(collection(alice(), name)));
            await assertFails(getDoc(doc(anon(), name, mine)));
            await assertSucceeds(getDocs(collection(admin(), name)));
            for (const db of [alice(), admin()]) {
                await assertFails(setDoc(doc(db, name, 'forged'), { userId: ALICE, amount: 1e6, delta: 1e6 }));
                await assertFails(updateDoc(doc(db, name, mine), { amount: 0, delta: 1e6 }));
            }
        }
    });

    it('lets a member mark their own notification read, and nothing else', async () => {
        await assertSucceeds(getDoc(doc(alice(), 'Notifications', 'nA')));
        await assertSucceeds(updateDoc(doc(alice(), 'Notifications', 'nA'), { read: true, readAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(alice(), 'Notifications', 'nA'), { title: 'Changed' }));
        await assertFails(getDoc(doc(alice(), 'Notifications', 'nB')));
        await assertFails(updateDoc(doc(alice(), 'Notifications', 'nB'), { read: true }));
        await assertFails(addDoc(collection(alice(), 'Notifications'), { userId: ALICE, title: 'Self' }));
        await assertFails(deleteDoc(doc(alice(), 'Notifications', 'nA')));
        await assertFails(getDoc(doc(anon(), 'Notifications', 'nA')));
        await assertSucceeds(getDoc(doc(admin(), 'Notifications', 'nB')));
    });
});

describe('audience and email records are admin only', () => {
    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            const db = ctx.firestore();
            await setDoc(doc(db, 'Contacts', 'h1'), { email: 'c@x.com' });
            await setDoc(doc(db, 'Suppression', 'h1'), { reason: 'bounce' });
            await setDoc(doc(db, 'EmailLogs', 'l1'), { to: 'c@x.com' });
            await setDoc(doc(db, 'Lists', 'all'), { name: 'All', memberCount: 1 });
        });
    });

    it('refuses visitors, members and a host app\'s admin', async () => {
        for (const db of [anon(), alice(), hostAdmin()]) {
            for (const [name, id] of [['Contacts', 'h1'], ['Suppression', 'h1'], ['EmailLogs', 'l1'], ['Lists', 'all']]) {
                await assertFails(getDoc(doc(db, name, id)));
                await assertFails(getDocs(collection(db, name)));
                await assertFails(setDoc(doc(db, name, 'x'), { email: 'x@x.com' }));
            }
        }
    });

    it('lets admins read them all, and write only lists and email logs', async () => {
        for (const [name, id] of [['Contacts', 'h1'], ['Suppression', 'h1'], ['EmailLogs', 'l1'], ['Lists', 'all']]) {
            await assertSucceeds(getDoc(doc(admin(), name, id)));
        }
        await assertFails(setDoc(doc(admin(), 'Contacts', 'h2'), { email: 'x@x.com' }));
        await assertFails(deleteDoc(doc(admin(), 'Suppression', 'h1')));
        await assertSucceeds(setDoc(doc(admin(), 'Lists', 'vip'), { name: 'VIP' }));
        await assertSucceeds(updateDoc(doc(admin(), 'EmailLogs', 'l1'), { note: 'checked' }));
    });
});
