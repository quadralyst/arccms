/**
 * generateMediaImages, the Media Manager's Create with AI tab (specs/ai-media-spec.md,
 * AM-D20 to AM-D26): admins only; Arc's own purpose or an app purpose that offers itself;
 * the estimate with the admin's pictures left today and the month's budget; a picture made
 * with only the chosen model, kept in ai-files/ and never the purpose's saveTo; and Edit with
 * AI with the library picture's largest size. askAi, Firestore and the limits are fakes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Data = Record<string, unknown>;
const h = vi.hoisted(() => ({
    settings: {} as Data,
    asks: [] as Array<{ input: Data; options: Data }>,
    answer: null as Data | null,
    used: 4,
    spent: 7.5,
    media: {} as Record<string, Data | undefined>,
}));

vi.mock('../init', () => ({
    db: { collection: (name: string) => ({ doc: (id: string) => ({ get: async () => ({ exists: name === 'media' && !!h.media[id], data: () => h.media[id] }) }) }) },
    storage: {},
    owner: {},
}));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (a: unknown, b?: unknown) => (typeof a === 'function' ? a : b),
    HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
vi.mock('../search/auth.js', () => ({
    requireAdmin: async (request: { auth?: { token?: Data } }) => {
        if (request.auth?.token?.['admin'] !== true) throw Object.assign(new Error('Admin access required.'), { code: 'permission-denied' });
    },
}));
vi.mock('../ai/settings.js', async (actual) => {
    const real = await actual<typeof import('../ai/settings.js')>();
    return { ...real, readAiSettings: async () => real.resolveAiSettings(h.settings) };
});
vi.mock('../ai/limits.js', () => ({ allowanceUsed: async () => h.used, monthSpent: async () => h.spent }));
vi.mock('../ai/askAi.js', () => ({ askAiForArc: async (input: Data, options: Data) => (h.asks.push({ input, options }), h.answer) }));
vi.mock('../custom/ai.js', () => ({
    AI_PURPOSES: {
        cover: { label: 'Cover', makes: 'image', instruction: 'Flat colours.', mediaManager: true, saveTo: 'app/covers', image: { aspect: '16:9' } },
        hidden: { label: 'Hidden', makes: 'image' },
        talk: { label: 'Talk', instruction: 'Answer.' },
    },
}));

import { generateMediaImages, tabImage } from '../ai/callables/generateMediaImages.js';
import { fileDaysByPurpose } from '../ai/callables/cleanUpAi.js';

const admin = (data: Data) => ({ auth: { uid: 'auth-1', token: { admin: true, arccms_uid: 'user-1' } }, data }) as never;
const member = (data: Data) => ({ auth: { uid: 'm1', token: {} }, data }) as never;
const call = generateMediaImages as unknown as (request: never) => Promise<Data>;

const OPENAI = { connection: 'oa', model: 'gpt-image-2' };
const MINI = { connection: 'oa', model: 'gpt-image-2.5-flare' };

beforeEach(() => {
    h.settings = {
        mode: 'live',
        connections: { oa: { preset: 'openai' }, or: { preset: 'openrouter' } },
        lists: { image: [OPENAI, MINI, { connection: 'or', model: 'qwen/qwen3.8-flash' }] },
        budget: { monthlyUsd: 20 },
    };
    h.asks = [];
    h.answer = { ok: true, files: [{ path: 'ai-files/arc-media-image/2026-11/rec-1.webp', mimeType: 'image/webp', bytes: 12, width: 1024, height: 1024 }], usage: { costUsd: 0.053, test: false }, recordId: 'rec' };
    h.used = 4;
    h.spent = 7.5;
    h.media = {};
});

describe('generateMediaImages', () => {
    it('is for admins, and only for Arc\'s purpose or one that offers itself to the Media Manager', async () => {
        await expect(call(member({ estimate: true }))).rejects.toThrow('Admin access required');
        await expect(call(admin({ estimate: true, purpose: 'hidden' }))).rejects.toThrow('mediaManager: true');
        await expect(call(admin({ estimate: true, purpose: 'talk' }))).rejects.toThrow('not a purpose the Media Manager can use');
        await expect(call(admin({ estimate: true, purpose: 'cover' }))).resolves.toMatchObject({ purpose: { id: 'cover', house: true } });
    });

    it('estimates before Generate: the picture models only, the cost, the pictures left today and the budget', async () => {
        const r = await call(admin({ estimate: true, prompt: 'fruit', image: { quality: 'high', count: 2 } }));
        expect((r['models'] as Data[]).map((m) => m['model'])).toEqual(['gpt-image-2', 'gpt-image-2.5-flare']);
        expect((r['models'] as Data[])[0]).toMatchObject({ label: 'OpenAI', unit: 'pictures', testedLive: false, image: expect.objectContaining({ edit: true }) });
        expect(r['estimate']).toMatchObject({ priced: true, amount: 2, unit: 'pictures' });
        expect(r['allowance']).toEqual({ perDay: 20, used: 4, left: 16 });
        expect(r['budget']).toEqual({ monthlyUsd: 20, spent: 7.5, left: 12.5 });
        expect(r['purpose']).toMatchObject({ id: 'arc-media-image', label: 'Media image', enabled: true });
        expect(h.asks).toEqual([]);
    });

    it('takes the admin\'s own allowance from Settings, AI', async () => {
        h.settings['purposes'] = { 'arc-media-image': { perKeyPerDay: 50 } };
        expect((await call(admin({ estimate: true })))['allowance']).toEqual({ perDay: 50, used: 4, left: 46 });
    });

    it('makes pictures with only the chosen model, under the admin\'s key, kept in ai-files/', async () => {
        // The note gets what the model was asked with, without the file type.
        h.answer = { ...h.answer!, image: { aspect: '1:1', resolution: 'standard', quality: 'low', count: 3, format: 'webp' } };
        const r = await call(admin({ purpose: 'cover', prompt: '  A bowl of fruit  ', model: MINI, image: { aspect: '1:1', quality: 'low', count: 3, bogus: 1 } }));
        expect(r['settings']).toEqual({ aspect: '1:1', resolution: 'standard', quality: 'low', count: 3, format: undefined });
        expect(h.asks[0]).toEqual({
            input: { purpose: 'cover', input: 'A bowl of fruit', limitKey: 'user-1', image: { aspect: '1:1', quality: 'low', count: 3 }, ref: undefined },
            options: { only: MINI, ignoreSaveTo: true },
        });
        expect(r).toMatchObject({ ok: true, recordId: 'rec', purpose: 'cover', model: MINI, costUsd: 0.053, test: false, files: [{ path: 'ai-files/arc-media-image/2026-11/rec-1.webp', width: 1024 }] });
    });

    it('refuses a model outside the list, an empty or long prompt, and says why nothing was made', async () => {
        await expect(call(admin({ prompt: 'x', model: { connection: 'or', model: 'qwen/qwen3.8-flash' } }))).rejects.toThrow('not in this purpose');
        await expect(call(admin({ prompt: '   ' }))).rejects.toThrow('Say what the picture should show');
        await expect(call(admin({ prompt: 'x'.repeat(2001) }))).rejects.toThrow('longer than 2000');
        h.answer = { ok: false, reason: 'limit', scope: 'key', wait: 3600, detail: 'user-1 has used its 20 for today', usage: {}, recordId: 'r2' };
        expect(await call(admin({ prompt: 'fruit' }))).toEqual({ ok: false, reason: 'limit', scope: 'key', wait: 3600, detail: 'user-1 has used its 20 for today', recordId: 'r2' });
        h.settings['lists'] = { image: [] };
        expect(await call(admin({ prompt: 'fruit' }))).toMatchObject({ ok: false, reason: 'off' });
    });

    it('edits a library picture through Arc\'s purpose, with its largest size and a model that edits', async () => {
        h.media['m1'] = { variants: { s: { path: 'mediaImages/a-s.webp' }, xl: { path: 'mediaImages/a-xl.webp' } } };
        await call(admin({ purpose: 'cover', prompt: 'make it blue', editOf: 'm1' }));
        expect(h.asks[0].input).toMatchObject({ purpose: 'arc-media-image', input: ['make it blue', { storagePath: 'mediaImages/a-xl.webp' }], ref: 'media/m1' });
        // Editors write media documents: a path outside the library's images is never read.
        h.media['bad'] = { variants: { xl: { path: 'users/u1/private.png' } } };
        await expect(call(admin({ prompt: 'x', editOf: 'bad' }))).rejects.toThrow('not in the media library');
        h.media['gif'] = { downloadURL: 'https://x/a.gif' };
        await expect(call(admin({ prompt: 'x', editOf: 'gif' }))).rejects.toThrow('cannot be edited');
        await expect(call(admin({ prompt: 'x', editOf: '../x' }))).rejects.toThrow('Choose a picture');
    });

    it('keeps only settings it knows, in range', () => {
        expect(tabImage({ aspect: '5:4', resolution: 'ultra', quality: 'best', count: 9, seed: 1.5, negativePrompt: '  text  ' })).toEqual({ negativePrompt: 'text' });
        expect(tabImage({ aspect: '21:9', resolution: 'high', quality: 'high', count: 4, seed: -3 })).toEqual({ aspect: '21:9', resolution: 'high', quality: 'high', count: 4, seed: -3 });
        expect(tabImage(null)).toEqual({});
    });

    it('deletes a Media Manager purpose\'s tab pictures with Media image\'s days when it has none of its own', async () => {
        expect(await fileDaysByPurpose()).toMatchObject({ 'arc-media-image': 7, cover: 7 });
        h.settings['purposes'] = { 'arc-media-image': { deleteAfterDays: 3 }, cover: { deleteAfterDays: 30 } };
        expect(await fileDaysByPurpose()).toMatchObject({ 'arc-media-image': 3, cover: 30 });
    });
});
