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
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

let env: RulesTestEnvironment;

const ALICE = 'alice-uid';
const BOB = 'bob-uid';

const alice = () => env.authenticatedContext(ALICE).firestore();
const admin = () => env.authenticatedContext('admin-uid', { role: 'admin' }).firestore();
const editor = () => env.authenticatedContext('editor-uid', { role: 'editor' }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-arccms-rules',
        firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
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

describe('users: create', () => {
    it('lets a user create their own doc with role user (the sign-up page)', async () => {
        await assertSucceeds(addDoc(collection(alice(), 'users'), { uid: ALICE, email: 'a2@x.com', role: 'user' }));
    });

    it('lets a user create their own doc with no role', async () => {
        await assertSucceeds(addDoc(collection(alice(), 'users'), { uid: ALICE, email: 'a2@x.com' }));
    });

    it('refuses a self-created admin doc (the escalation)', async () => {
        await assertFails(addDoc(collection(alice(), 'users'), { uid: ALICE, email: 'a2@x.com', role: 'admin' }));
    });

    it('refuses any other role too', async () => {
        await assertFails(addDoc(collection(alice(), 'users'), { uid: ALICE, role: 'editor' }));
        await assertFails(addDoc(collection(alice(), 'users'), { uid: ALICE, role: 'propertyOwner' }));
    });

    it("refuses a doc for someone else's uid", async () => {
        await assertFails(addDoc(collection(alice(), 'users'), { uid: BOB, role: 'user' }));
    });

    it('refuses unauthenticated creates', async () => {
        await assertFails(addDoc(collection(anon(), 'users'), { uid: ALICE, role: 'user' }));
    });

    it('lets an admin create a user with any role', async () => {
        await assertSucceeds(addDoc(collection(admin(), 'users'), { uid: 'new', role: 'admin' }));
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

describe('content writes are staff only', () => {
    const writes = (db: ReturnType<typeof alice>) => [
        () => setDoc(doc(db, 'ContentTypes', 'articles'), { slug: 'articles', name: 'x' }),
        () => setDoc(doc(db, 'arc_articles', 'p1'), { title: 'x' }),
        () => setDoc(doc(db, 'arc_articles_drafts', 'd1'), { title: 'x' }),
        () => setDoc(doc(db, 'arc_articles_drafts', 'd1', 'translations', 'fr'), { title: 'x' }),
        () => setDoc(doc(db, 'Tags_articles', 't1'), { name: 'x' }),
        () => setDoc(doc(db, 'media', 'm1'), { downloadURL: 'x' }),
        () => addDoc(collection(db, '_publish_queue'), { action: 'publish' }),
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
