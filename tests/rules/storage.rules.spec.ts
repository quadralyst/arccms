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
const admin = () => env.authenticatedContext('admin-uid', { role: 'admin' }).storage();
const anon = () => env.unauthenticatedContext().storage();

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-arccms-rules',
        storage: { rules: readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8') },
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
