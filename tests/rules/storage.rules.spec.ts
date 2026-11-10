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
import { deleteObject, getBytes, list, listAll, ref, updateMetadata, uploadBytes } from 'firebase/storage';
import { ALLOWED_FILES, MAX_FILE_BYTES } from '../../src/shared/utils/media-files';
import { STAFF_FILE_TYPES } from '../../src/shared/utils/staff-files';

let env: RulesTestEnvironment;

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const asImage = { contentType: 'image/png' };

const alice = () => env.authenticatedContext('alice-uid').storage();
const admin = () => env.authenticatedContext('admin-uid', { arccms_role: 'admin' }).storage();
// A host app's own admin in a shared sign-in pool (CO-D7): not an ArcCMS admin.
const hostAdmin = () => env.authenticatedContext('host-uid', { role: 'admin' }).storage();
const anon = () => env.unauthenticatedContext().storage();
const editor = () => env.authenticatedContext('editor-uid', { arccms_role: 'editor' }).storage();

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

    it('lets a member write a photo in their own avatar folder, as the profile page names it', async () => {
        await assertSucceeds(uploadBytes(ref(alice(), 'avatars/alice-uid/avatar-1731240000000.webp'), png, { contentType: 'image/webp' }));
        await assertSucceeds(uploadBytes(ref(alice(), 'avatars/alice-uid/avatar-1731240000001.png'), png, asImage));
        await assertSucceeds(uploadBytes(ref(alice(), 'avatars/alice-uid/avatar-1731240000002.jpg'), png, { contentType: 'image/jpeg' }));
        await assertSucceeds(deleteObject(ref(alice(), 'avatars/alice-uid/avatar-1731240000001.png')));
        await assertSucceeds(getBytes(ref(anon(), 'avatars/alice-uid/avatar-1731240000000.webp')));
    });

    it("refuses another member's folder, SVG and other types, other names and big files", async () => {
        await assertFails(uploadBytes(ref(alice(), 'avatars/bob-uid/avatar-1.png'), png, asImage));
        await assertFails(uploadBytes(ref(alice(), 'avatars/alice-uid/x.html'), png, { contentType: 'text/html' }));
        await assertFails(uploadBytes(ref(alice(), 'avatars/alice-uid/avatar-1.svg'), png, { contentType: 'image/svg+xml' }));
        await assertFails(uploadBytes(ref(alice(), 'avatars/alice-uid/avatar-1.png'), png, { contentType: 'image/svg+xml' }));
        await assertFails(uploadBytes(ref(alice(), 'avatars/alice-uid/avatar-1.gif'), png, { contentType: 'image/gif' }));
        await assertFails(uploadBytes(ref(alice(), 'avatars/alice-uid/me.png'), png, asImage));
        await assertFails(uploadBytes(ref(alice(), 'avatars/alice-uid/avatar-1.png'), new Uint8Array(1024 * 1024), asImage));
    });

    it('refuses unauthenticated writes', async () => {
        await assertFails(uploadBytes(ref(anon(), 'avatars/alice-uid/avatar-1.png'), png, asImage));
    });
});

describe('listing the bucket', () => {
    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await uploadBytes(ref(ctx.storage(), 'root.png'), png, asImage);
            await uploadBytes(ref(ctx.storage(), 'arccms/mediaImages/site.png'), png, asImage);
            await uploadBytes(ref(ctx.storage(), 'mediaFiles/guide.pdf'), png, { contentType: 'application/pdf' });
            await uploadBytes(ref(ctx.storage(), 'avatars/alice-uid/avatar-1.png'), png, asImage);
        });
    });

    it('lets anyone fetch a file by its path, and nobody but staff list a folder', async () => {
        for (const path of ['root.png', 'mediaImages/site.png', 'arccms/mediaImages/site.png', 'mediaFiles/guide.pdf']) {
            await assertSucceeds(getBytes(ref(anon(), path)));
        }
        for (const storage of [anon(), alice(), hostAdmin()]) {
            for (const folder of ['', 'mediaImages', 'arccms/mediaImages', 'mediaFiles', 'avatars/alice-uid']) {
                await assertFails(list(ref(storage, folder), { maxResults: 10 }));
            }
        }
        for (const folder of ['', 'mediaImages', 'arccms/mediaImages', 'mediaFiles', 'avatars/alice-uid']) {
            await assertSucceeds(list(ref(admin(), folder), { maxResults: 10 }));
        }
        await assertSucceeds(listAll(ref(admin(), 'mediaImages')));
        await assertSucceeds(list(ref(editor(), 'mediaImages'), { maxResults: 10 }));
        await assertFails(list(ref(editor(), 'users'), { maxResults: 10 }));
        await assertFails(list(ref(editor(), 'email-logs'), { maxResults: 10 }));
    });

    // Under the upload folder the members' folders are as closed as at the root.
    it("lets an editor list the upload folder but not the members' folders in it", async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await uploadBytes(ref(ctx.storage(), 'arccms/users/rec-alice/private.png'), png, asImage);
            await uploadBytes(ref(ctx.storage(), 'arccms/email-logs/log1/a.pdf'), png, { contentType: 'application/pdf' });
        });
        for (const folder of ['arccms/users', 'arccms/users/rec-alice', 'arccms/email-logs', 'arccms/ai-files']) {
            await assertFails(list(ref(editor(), folder), { maxResults: 10 }));
            await assertSucceeds(list(ref(admin(), folder), { maxResults: 10 }));
        }
        await assertSucceeds(list(ref(editor(), 'arccms'), { maxResults: 10 }));
        await assertSucceeds(list(ref(editor(), 'arccms/mediaImages'), { maxResults: 10 }));
    });
});

describe('staff uploads', () => {
    it('take images, PDF, video, audio, fonts and plain data', async () => {
        const ok: Array<[string, string]> = [
            ['mediaImages/a.jpg', 'image/jpeg'], ['mediaImages/a.webp', 'image/webp'], ['mediaImages/a.gif', 'image/gif'],
            ['arccms/mediaImages/a.png', 'image/png'], ['site/brochure.pdf', 'application/pdf'], ['site/intro.mp4', 'video/mp4'],
            ['site/theme.mp3', 'audio/mpeg'], ['fonts/brand.woff2', 'font/woff2'], ['notes.txt', 'text/plain'],
        ];
        for (const [path, contentType] of ok) await assertSucceeds(uploadBytes(ref(admin(), path), png, { contentType }));
    });

    // Import Files checks a file against this list before it uploads (src/shared/utils/staff-files.ts).
    it('take every type on the Import Files list, stored as its extension names it', async () => {
        for (const [extension, contentType] of Object.entries(STAFF_FILE_TYPES)) {
            await assertSucceeds(uploadBytes(ref(editor(), `arccms/site/file.${extension}`), png, { contentType }));
        }
    });

    it('refuse pages, SVG, scripts and archives anywhere in the bucket', async () => {
        const bad: Array<[string, string]> = [
            ['page.html', 'text/html'], ['mediaImages/x.html', 'text/html'], ['mediaImages/logo.svg', 'image/svg+xml'],
            ['arccms/mediaImages/x.js', 'application/javascript'], ['site/x.js', 'text/javascript'],
            ['site/all.zip', 'application/zip'], ['site/feed.xml', 'application/xml'], ['site/raw.bin', 'application/octet-stream'],
        ];
        for (const [path, contentType] of bad) await assertFails(uploadBytes(ref(admin(), path), png, { contentType }));
    });

    it("never write into a member's folder or the avatar folders", async () => {
        for (const path of ['users/rec-alice/new.png', 'arccms/users/rec-alice/new.png', 'avatars/alice-uid/avatar-1.png', 'arccms/avatars/x/a.png']) {
            await assertFails(uploadBytes(ref(admin(), path), png, asImage));
            await assertFails(uploadBytes(ref(editor(), path), png, asImage));
        }
    });
});

describe('per-user folders (docs/app/account-contract.html)', () => {
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

    it('take the owner\'s feedback files (a JPEG screenshot, a voice note), create only', async () => {
        const audio = { contentType: 'audio/mp4' };
        const jpeg = { contentType: 'image/jpeg' };
        await assertSucceeds(uploadBytes(ref(owner(), 'users/rec-alice/feedback/f1/screenshot.jpg'), png, jpeg));
        // Review F: only the two files the button makes, by name and type.
        await assertFails(uploadBytes(ref(owner(), 'users/rec-alice/feedback/f2/screenshot.jpg'), png, { contentType: 'image/svg+xml' }));
        await assertFails(uploadBytes(ref(owner(), 'users/rec-alice/feedback/f2/photo.png'), png, asImage));
        await assertFails(uploadBytes(ref(owner(), 'users/rec-alice/feedback/f2/voice.mp3'), png, { contentType: 'audio/mpeg' }));
        await assertSucceeds(uploadBytes(ref(owner(), 'arccms/users/rec-alice/feedback/f1/voice.mp4'), png, audio));
        await assertFails(uploadBytes(ref(owner(), 'users/rec-alice/feedback/f1/notes.txt'), png, { contentType: 'text/plain' }));
        await assertFails(uploadBytes(ref(other(), 'users/rec-alice/feedback/f1/screenshot.jpg'), png, asImage));
        await assertFails(uploadBytes(ref(owner(), 'users/rec-alice/feedback/f1/screenshot.jpg'), png, jpeg)); // no overwrite
    });

    it("let an admin delete a feedback file with its feedback, and nobody else", async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await uploadBytes(ref(ctx.storage(), 'users/rec-alice/feedback/f9/screenshot.jpg'), png, { contentType: 'image/jpeg' });
            await uploadBytes(ref(ctx.storage(), 'arccms/users/rec-alice/feedback/f9/voice.webm'), png, { contentType: 'audio/webm' });
        });
        await assertFails(deleteObject(ref(owner(), 'users/rec-alice/feedback/f9/screenshot.jpg')));
        await assertFails(deleteObject(ref(editor(), 'users/rec-alice/feedback/f9/screenshot.jpg')));
        await assertSucceeds(deleteObject(ref(admin(), 'users/rec-alice/feedback/f9/screenshot.jpg')));
        await assertSucceeds(deleteObject(ref(admin(), 'arccms/users/rec-alice/feedback/f9/voice.webm')));
    });

    it('leave everything else public, under the upload folder and at the root', async () => {
        await assertSucceeds(getBytes(ref(anon(), 'arccms/mediaImages/site.png')));
        await assertSucceeds(getBytes(ref(anon(), 'root.png')));
    });
});

describe('email log files (specs/app-email-spec.md, AE-D8)', () => {
    const editor = () => env.authenticatedContext('ed-uid', { arccms_role: 'editor' }).storage();
    const csv = { contentType: 'text/csv' };

    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await uploadBytes(ref(ctx.storage(), 'email-logs/log1/1-sales.csv'), png, csv);
            await uploadBytes(ref(ctx.storage(), 'arccms/email-logs/log1/1-sales.csv'), png, csv);
        });
    });

    it('are never public, at the bucket root or under the upload folder', async () => {
        await assertFails(getBytes(ref(anon(), 'email-logs/log1/1-sales.csv')));
        await assertFails(getBytes(ref(anon(), 'arccms/email-logs/log1/1-sales.csv')));
        await assertFails(getBytes(ref(alice(), 'email-logs/log1/1-sales.csv')));
        await assertFails(getBytes(ref(editor(), 'arccms/email-logs/log1/1-sales.csv')));
    });

    it('are read by admins, in Email Logs', async () => {
        await assertSucceeds(getBytes(ref(admin(), 'email-logs/log1/1-sales.csv')));
        await assertSucceeds(getBytes(ref(admin(), 'arccms/email-logs/log1/1-sales.csv')));
    });

    it('are written by the functions only, never from a browser', async () => {
        await assertFails(uploadBytes(ref(admin(), 'email-logs/log1/2-new.csv'), png, csv));
        await assertFails(uploadBytes(ref(admin(), 'arccms/email-logs/log1/1-sales.csv'), png, csv));
        await assertFails(uploadBytes(ref(editor(), 'arccms/email-logs/log2/1-x.csv'), png, csv));
        await assertFails(deleteObject(ref(admin(), 'email-logs/log1/1-sales.csv')));
    });
});

describe('AI record files (docs/app/ai.html)', () => {
    const editor = () => env.authenticatedContext('editor-uid', { arccms_role: 'editor' }).storage();
    const jpeg = { contentType: 'image/jpeg' };

    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await uploadBytes(ref(ctx.storage(), 'ai-calls/c1/1-menu.jpeg'), png, jpeg);
            await uploadBytes(ref(ctx.storage(), 'arccms/ai-calls/c1/1-menu.jpeg'), png, jpeg);
        });
    });

    it('are never public, at the bucket root or under the upload folder', async () => {
        await assertFails(getBytes(ref(anon(), 'ai-calls/c1/1-menu.jpeg')));
        await assertFails(getBytes(ref(anon(), 'arccms/ai-calls/c1/1-menu.jpeg')));
        await assertFails(getBytes(ref(alice(), 'ai-calls/c1/1-menu.jpeg')));
        await assertFails(getBytes(ref(editor(), 'arccms/ai-calls/c1/1-menu.jpeg')));
    });

    it('are read by admins', async () => {
        await assertSucceeds(getBytes(ref(admin(), 'ai-calls/c1/1-menu.jpeg')));
        await assertSucceeds(getBytes(ref(admin(), 'arccms/ai-calls/c1/1-menu.jpeg')));
    });

    it('are written by the functions only, never from a browser', async () => {
        await assertFails(uploadBytes(ref(admin(), 'ai-calls/c1/2-new.jpeg'), png, jpeg));
        await assertFails(uploadBytes(ref(editor(), 'arccms/ai-calls/c2/1-x.jpeg'), png, jpeg));
        await assertFails(deleteObject(ref(admin(), 'ai-calls/c1/1-menu.jpeg')));
    });
});

describe('Files AI made (specs/ai-media-spec.md, AM-D9)', () => {
    const editor = () => env.authenticatedContext('editor-uid', { arccms_role: 'editor' }).storage();
    const pngType = { contentType: 'image/png' };
    const paths = ['ai-files/cover/2026-11/r1-1.png', 'arccms/ai-files/cover/2026-11/r1-1.png', 'ai-files/_test/cover/2026-11/r2-1.png'];

    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            for (const p of paths) await uploadBytes(ref(ctx.storage(), p), png, pngType);
        });
    });

    it('are never public, at the bucket root or under the upload folder', async () => {
        for (const p of paths) {
            await assertFails(getBytes(ref(anon(), p)));
            await assertFails(getBytes(ref(alice(), p)));
            await assertFails(getBytes(ref(editor(), p)));
        }
    });

    it('are read by admins', async () => {
        for (const p of paths) await assertSucceeds(getBytes(ref(admin(), p)));
    });

    it('are written by the functions only, never from a browser', async () => {
        await assertFails(uploadBytes(ref(admin(), 'ai-files/cover/2026-11/new.png'), png, pngType));
        await assertFails(uploadBytes(ref(editor(), 'arccms/ai-files/cover/2026-11/new.png'), png, pngType));
        await assertFails(deleteObject(ref(admin(), paths[0])));
    });
});

describe('library files (docs/features/media.html, Files)', () => {
    const editor = () => env.authenticatedContext('editor-uid', { arccms_role: 'editor' }).storage();
    const pdf = { contentType: 'application/pdf' };

    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await uploadBytes(ref(ctx.storage(), 'mediaFiles/report-abc123.pdf'), png, pdf);
        });
    });

    it('take every allowed extension with its own content type, at the root and under the upload folder', async () => {
        for (const file of ALLOWED_FILES) {
            await assertSucceeds(uploadBytes(ref(admin(), `mediaFiles/a-x1y2z3.${file.extension}`), png, { contentType: file.contentType }));
            await assertSucceeds(uploadBytes(ref(editor(), `arccms/mediaFiles/a-x1y2z3.${file.extension}`), png, { contentType: file.contentType }));
        }
        await assertSucceeds(uploadBytes(ref(admin(), 'mediaFiles/a-x1y2z3-thumb.jpg'), png, { contentType: 'image/jpeg' }));
    });

    it('refuse a type the extension does not match, and anything not on the list', async () => {
        await assertFails(uploadBytes(ref(admin(), 'mediaFiles/page.pdf'), png, { contentType: 'text/html' }));
        await assertFails(uploadBytes(ref(admin(), 'mediaFiles/page.html'), png, { contentType: 'text/html' }));
        await assertFails(uploadBytes(ref(admin(), 'mediaFiles/logo.svg'), png, { contentType: 'image/svg+xml' }));
        await assertFails(uploadBytes(ref(admin(), 'mediaFiles/all.zip'), png, { contentType: 'application/zip' }));
        await assertFails(uploadBytes(ref(admin(), 'mediaFiles/macro.docm'), png, { contentType: 'application/vnd.ms-word.document.macroEnabled.12' }));
        await assertFails(uploadBytes(ref(admin(), 'mediaFiles/photo.jpg'), png, { contentType: 'image/jpeg' }));
        await assertFails(uploadBytes(ref(admin(), 'arccms/mediaFiles/page.html'), png, { contentType: 'text/html' }));
        await assertFails(uploadBytes(ref(admin(), 'mediaFiles/nested/a.pdf'), png, pdf));
    });

    it('refuse a file over 20 MB', async () => {
        const big = new Uint8Array(MAX_FILE_BYTES + 1);
        await assertFails(uploadBytes(ref(admin(), 'mediaFiles/big.pdf'), big, pdf));
    }, 60_000);

    it('are written and deleted by staff only, and read by anyone', async () => {
        await assertFails(uploadBytes(ref(alice(), 'mediaFiles/a.pdf'), png, pdf));
        await assertFails(uploadBytes(ref(hostAdmin(), 'mediaFiles/a.pdf'), png, pdf));
        await assertFails(deleteObject(ref(alice(), 'mediaFiles/report-abc123.pdf')));
        await assertSucceeds(getBytes(ref(anon(), 'mediaFiles/report-abc123.pdf')));
        await assertSucceeds(updateMetadata(ref(editor(), 'mediaFiles/report-abc123.pdf'), { contentDisposition: 'inline; filename="Report.pdf"' }));
        await assertSucceeds(deleteObject(ref(editor(), 'mediaFiles/report-abc123.pdf')));
    });
});
