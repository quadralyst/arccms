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
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';

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

    it('lets an admin create a user with any role', async () => {
        await assertSucceeds(addDoc(collection(admin(), 'users'), { uid: 'new', role: 'admin' }));
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

    it('lets emailVerified go to false (email change) but not to true', async () => {
        await env.withSecurityRulesDisabled((ctx) =>
            updateDoc(doc(ctx.firestore(), 'users', 'alice-doc'), { emailVerified: true }));
        await assertSucceeds(updateDoc(doc(alice(), 'users', 'alice-doc'), { email: 'n@x.com', emailVerified: false }));
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { emailVerified: true }));
    });

    it('still refuses premium fields', async () => {
        await assertFails(updateDoc(doc(alice(), 'users', 'alice-doc'), { isPro: true }));
    });

    it("refuses editing someone else's doc", async () => {
        await assertFails(updateDoc(doc(alice(), 'users', 'bob-doc'), { name: 'pwned' }));
    });

    it('lets an admin change a role', async () => {
        await assertSucceeds(updateDoc(doc(admin(), 'users', 'alice-doc'), { role: 'admin' }));
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
});

describe('content writes are staff only', () => {
    const writes = (db: ReturnType<typeof alice>) => [
        () => setDoc(doc(db, 'ContentTypes', 'articles'), { slug: 'articles', name: 'x' }),
        () => setDoc(doc(db, 'arc_articles', 'p1'), { title: 'x' }),
        () => setDoc(doc(db, 'arc_articles_drafts', 'd1'), { title: 'x' }),
        () => setDoc(doc(db, 'arc_articles_drafts', 'd1', 'translations', 'fr'), { title: 'x' }),
        () => setDoc(doc(db, 'Tags_articles', 't1'), { name: 'x' }),
        () => setDoc(doc(db, 'media', 'm1'), { downloadURL: 'x' }),
        () => addDoc(collection(db, '_publish_queue'), { action: 'publish' }),
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

    it('lets an admin set them', async () => {
        await assertSucceeds(updateDoc(doc(admin(), 'users', 'alice-doc'), { email: 'new@x.com', phone: '+919876543210' }));
    });

    it('keeps codes, PINs, the number index and rate limits closed to everyone', async () => {
        for (const name of ['phone_otps', 'phone_index', 'auth_pins', '_rate_limits']) {
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

    it('keeps Settings/sms (the MSG91 key) admin only', async () => {
        await assertFails(getDoc(doc(alice(), 'Settings', 'sms')));
        await assertFails(getDoc(doc(anon(), 'Settings', 'sms')));
        await assertSucceeds(setDoc(doc(admin(), 'Settings', 'sms'), { provider: 'log' }));
    });
});

describe('data under a users record (docs/account-contract.md)', () => {
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

describe('feedback (docs/feedback.md)', () => {
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
