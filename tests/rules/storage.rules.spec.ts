/**
 * Storage rules: staff-only writes, plus each member's own avatar folder (CO1).
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
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

let env: RulesTestEnvironment;

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const asImage = { contentType: 'image/png' };

const alice = () => env.authenticatedContext('alice-uid').storage();
const admin = () => env.authenticatedContext('admin-uid', { arccms_role: 'admin' }).storage();
// A host app's own admin in a shared sign-in pool (CO-D7): not an ArcCMS admin.
const hostAdmin = () => env.authenticatedContext('host-uid', { role: 'admin' }).storage();
const anon = () => env.unauthenticatedContext().storage();

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-arccms-rules',
        storage: { rules: readFileSync(resolve(__dirname, '../../.arc-build/storage.rules'), 'utf8') },
    });
});

afterAll(async () => {
    await env?.cleanup();
});

beforeEach(async () => {
    await env.clearStorage();
    await env.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), 'mediaImages/site.png'), png, asImage);
    });
});

describe('storage', () => {
    it('keeps reads public', async () => {
        await assertSucceeds(getBytes(ref(anon(), 'mediaImages/site.png')));
    });

    it('refuses a signed-in non-admin writing to the media library', async () => {
        await assertFails(uploadBytes(ref(alice(), 'mediaImages/evil.png'), png, asImage));
        await assertFails(uploadBytes(ref(alice(), 'mediaImages/site.png'), png, asImage));
        await assertFails(deleteObject(ref(alice(), 'mediaImages/site.png')));
    });

    it('refuses a plain `role` claim, which a host app may set (CO-D7)', async () => {
        await assertFails(uploadBytes(ref(hostAdmin(), 'mediaImages/new.png'), png, asImage));
        await assertFails(deleteObject(ref(hostAdmin(), 'mediaImages/site.png')));
    });

    it('lets an admin write anywhere', async () => {
        await assertSucceeds(uploadBytes(ref(admin(), 'mediaImages/new.png'), png, asImage));
        await assertSucceeds(uploadBytes(ref(admin(), 'imports/data.json'), png, { contentType: 'application/json' }));
    });

    it('lets a member write an image in their own avatar folder', async () => {
        await assertSucceeds(uploadBytes(ref(alice(), 'avatars/alice-uid/me.png'), png, asImage));
    });

    it("refuses another member's folder and non-image files", async () => {
        await assertFails(uploadBytes(ref(alice(), 'avatars/bob-uid/me.png'), png, asImage));
        await assertFails(uploadBytes(ref(alice(), 'avatars/alice-uid/x.html'), png, { contentType: 'text/html' }));
    });

    it('refuses unauthenticated writes', async () => {
        await assertFails(uploadBytes(ref(anon(), 'avatars/alice-uid/me.png'), png, asImage));
    });
});

describe('per-user folders (docs/account-contract.md)', () => {
    const owner = () => env.authenticatedContext('alice-uid', { arccms_uid: 'rec-alice' }).storage();
    const other = () => env.authenticatedContext('bob-uid', { arccms_uid: 'rec-bob' }).storage();
    const noClaim = () => env.authenticatedContext('alice-uid').storage();

    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await uploadBytes(ref(ctx.storage(), 'users/rec-alice/private.png'), png, asImage);
            await uploadBytes(ref(ctx.storage(), 'arccms/users/rec-alice/private.png'), png, asImage);
            await uploadBytes(ref(ctx.storage(), 'arccms/mediaImages/site.png'), png, asImage);
            await uploadBytes(ref(ctx.storage(), 'root.png'), png, asImage);
        });
    });

    it('are never public, at the bucket root or under the upload folder', async () => {
        await assertFails(getBytes(ref(anon(), 'users/rec-alice/private.png')));
        await assertFails(getBytes(ref(anon(), 'arccms/users/rec-alice/private.png')));
    });

    it('can be read by their owner (the arccms_uid claim) and admins only', async () => {
        await assertSucceeds(getBytes(ref(owner(), 'users/rec-alice/private.png')));
        await assertSucceeds(getBytes(ref(owner(), 'arccms/users/rec-alice/private.png')));
        await assertSucceeds(getBytes(ref(admin(), 'users/rec-alice/private.png')));
        await assertFails(getBytes(ref(other(), 'users/rec-alice/private.png')));
        await assertFails(getBytes(ref(noClaim(), 'users/rec-alice/private.png')));
    });

    it('cannot be written by their owner without an app rule', async () => {
        await assertFails(uploadBytes(ref(owner(), 'users/rec-alice/new.png'), png, asImage));
    });

    it('take the owner\'s feedback files (image or audio, under 10 MB), create only', async () => {
        const audio = { contentType: 'audio/mp4' };
        await assertSucceeds(uploadBytes(ref(owner(), 'users/rec-alice/feedback/f1/screenshot.jpg'), png, asImage));
        await assertSucceeds(uploadBytes(ref(owner(), 'arccms/users/rec-alice/feedback/f1/voice.mp4'), png, audio));
        await assertFails(uploadBytes(ref(owner(), 'users/rec-alice/feedback/f1/notes.txt'), png, { contentType: 'text/plain' }));
        await assertFails(uploadBytes(ref(other(), 'users/rec-alice/feedback/f1/screenshot.jpg'), png, asImage));
        await assertFails(uploadBytes(ref(owner(), 'users/rec-alice/feedback/f1/screenshot.jpg'), png, asImage)); // no overwrite
    });

    it('leave everything else public, under the upload folder and at the root', async () => {
        await assertSucceeds(getBytes(ref(anon(), 'arccms/mediaImages/site.png')));
        await assertSucceeds(getBytes(ref(anon(), 'root.png')));
    });
});
