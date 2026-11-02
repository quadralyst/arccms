/**
 * askAi for pictures (specs/ai-media-spec.md, AM-D4, AM-D5, AM-D15, AM-D19, AM-D24): each
 * model asked with the call's settings fitted to it, the nearest shape recorded, a model
 * skipped for a seed or an edit it cannot take, the price by quality, MiniMax's own picture
 * limit, and Arc's Media Manager keeping files in ai-files/ over the purpose's saveTo. The
 * providers are fake connectors; Firestore and Storage are mocked at their modules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    settings: {} as Record<string, unknown>,
    records: [] as Array<{ record: Record<string, unknown>; id: string | undefined }>,
    totals: [] as Array<Record<string, unknown>>,
    consumed: [] as number[],
    budgetChecks: 0,
    saved: new Map<string, { bytes: Buffer; contentType: string }>(),
    copied: [] as Array<[string, string]>,
    cacheHit: null as null | Record<string, unknown>,
    cacheLookups: 0,
    cacheStored: [] as Array<Record<string, unknown>>,
    place: { ok: true } as { ok: boolean; wait?: number },
    credit: [] as string[],
    copyFails: false,
    saveFails: false,
    noted: [] as Array<[string, string | null]>,
    paced: [] as Array<[string, unknown]>,
    released: [] as Array<number | undefined>,
}));

vi.mock('../custom/ai.js', () => ({
    AI_PURPOSES: {
        cover: { label: 'Cover', makes: 'image', instruction: 'Flat colours.', image: { aspect: '16:9', quality: 'high' }, saveTo: 'app/covers' },
        counted: { label: 'Counted', makes: 'image', perKeyPerDay: 20, allowanceIn: 'pictures' },
        seeded: { label: 'Seeded', makes: 'image', image: { seed: 42 } },
        edit: { label: 'Edit', makes: 'image', input: { pictures: { max: 1, maxMb: 5 } } },
    },
}));
vi.mock('../feature-flags.js', () => ({ isFeatureOn: () => true }));
vi.mock('../init', () => ({
    db: {},
    owner: {},
    storage: {
        bucket: () => ({
            file: (path: string) => ({
                save: async (bytes: Buffer, o: { contentType: string }) => {
                    if (h.saveFails) throw new Error('Storage is down');
                    h.saved.set(path, { bytes, contentType: o.contentType });
                },
                copy: async (to: { name: string }) => {
                    if (h.copyFails) throw new Error('No such object');
                    h.copied.push([path, to.name]);
                },
                getMetadata: async () => [{ contentType: h.saved.get(path)?.contentType ?? 'image/png', size: String(h.saved.get(path)?.bytes.length ?? 123) }],
                name: path,
            }),
        }),
    },
}));
vi.mock('../ai/settings.js', async (actual) => {
    const real = await actual<typeof import('../ai/settings.js')>();
    return { ...real, readAiSettings: async () => real.resolveAiSettings(h.settings) };
});
vi.mock('../ai/records.js', () => ({
    newAiCallId: () => 'rec1',
    writeAiCall: async (record: Record<string, unknown>, _content: unknown, _now: Date, id?: string) => (h.records.push({ record, id }), id ?? 'x'),
}));
vi.mock('../ai/usage.js', () => ({
    addToTotals: async (record: Record<string, unknown>) => void h.totals.push(record),
    noteConnection: async (_s: unknown, id: string, error: string | null) => void h.noted.push([id, error]),
    alertOutOfCredit: async (id: string) => void h.credit.push(id),
}));
vi.mock('../ai/limits.js', () => ({
    consumeAllowance: async (_p: string, _k: string, units: number) => (h.consumed.push(units), { ok: true, release: async (n?: number) => void h.released.push(n) }),
    checkBudget: async () => (h.budgetChecks++, { ok: true, spent: 0 }),
}));
vi.mock('../ai/keys.js', () => ({ readKey: async () => ({ ok: true, key: 'sk-12345678' }) }));
vi.mock('../ai/cache.js', async (actual) => {
    const real = await actual<typeof import('../ai/cache.js')>();
    return {
        ...real,
        findCached: async (hashes: Array<{ hash: string; ref: { connection: string; model: string } }>) => (h.cacheLookups++, h.cacheHit ? { hash: hashes[0].hash, connection: hashes[0].ref.connection, model: hashes[0].ref.model, ...h.cacheHit } : null),
        storeCached: async (entry: Record<string, unknown>) => void h.cacheStored.push(entry),
    };
});
vi.mock('../ai/pacing.js', () => ({ waitForPlace: async (key: string, limits: unknown) => (h.paced.push([key, limits]), h.place.ok ? { ok: true, release: async () => undefined } : { ok: false, wait: h.place.wait }) }));

import { askAi, askAiForArc } from '../ai/askAi.js';
import { replaceFileConnectorsForTest } from '../ai/connectors/index.js';
import type { FileConnector, FileRequest, FileResult } from '../ai/connectors/types.js';
import { greyPng } from '../ai/standins.js';

const PNG = greyPng(8, 8);
const made = (n = 1): FileResult => ({ ok: true, files: Array.from({ length: n }, () => ({ bytes: PNG, mimeType: 'image/png', width: 8, height: 8 })), usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 } });

function live(lists: Array<{ connection: string; model: string }>, extra: Record<string, unknown> = {}) {
    h.settings = { mode: 'live', connections: { oa: { preset: 'openai' }, gem: { preset: 'gemini-api' }, mm: { preset: 'minimax' }, mm2: { preset: 'minimax', perMinute: 30 } }, lists: { image: lists }, ...extra };
}

function painters(answers: Partial<Record<'openai' | 'gemini' | 'minimax', FileResult>> = {}): FileRequest[] {
    const asked: FileRequest[] = [];
    const make = (k: 'openai' | 'gemini' | 'minimax'): FileConnector => async (_c, r) => (asked.push({ ...r, model: `${k}:${r.model}` }), answers[k] ?? made(r.image?.count ?? 1));
    replaceFileConnectorsForTest({ openai: make('openai'), gemini: make('gemini'), minimax: make('minimax') });
    return asked;
}

const OA = { connection: 'oa', model: 'gpt-image-2' };
const GM = { connection: 'gem', model: 'gemini-nano-banana-2.1' };
const MM = { connection: 'mm', model: 'image-01' };

beforeEach(() => {
    h.records = []; h.totals = []; h.consumed = []; h.saved.clear(); h.copied = []; h.cacheHit = null; h.cacheStored = []; h.place = { ok: true }; h.noted = []; h.paced = []; h.released = [];
});
afterEach(() => replaceFileConnectorsForTest({}));

describe('askAi for pictures', () => {
    it('asks each model with what it takes: the nearest shape, a quality only where taken, and records it', async () => {
        live([OA]);
        const asked = painters();
        const r = await askAi({ purpose: 'cover', input: 'A bowl of fruit', image: { count: 2 } });
        expect(asked[0].image).toEqual({ aspect: '16:9', resolution: 'standard', quality: 'high', count: 2, format: 'png' });
        expect(asked[0].prompt).toBe('A bowl of fruit\n\nFlat colours.');
        expect(h.records[0].record['image']).toEqual(asked[0].image);
        // gpt-image-2 at high quality: 0.211 a picture.
        expect(r).toMatchObject({ ok: true, usage: { amount: 2, unit: 'pictures' } });
        expect((r as { usage: { costUsd: number } }).usage.costUsd).toBeCloseTo(0.422, 9);
    });

    it('prices a Gemini picture by its resolution and leaves out the quality it does not take', async () => {
        live([GM]);
        const asked = painters();
        const r = await askAi({ purpose: 'cover', input: 'fruit', image: { resolution: 'high' } });
        expect(asked[0].image).toEqual({ aspect: '16:9', resolution: 'high', count: 1, format: 'png' });
        expect((r as { usage: { costUsd: number } }).usage.costUsd).toBeCloseTo(0.0504, 9);
    });

    it('skips a model that takes no seed for one that does', async () => {
        live([OA, MM]);
        const asked = painters();
        const r = await askAi({ purpose: 'seeded', input: 'fruit' });
        expect(asked.map((a) => a.model)).toEqual(['minimax:image-01']);
        expect(asked[0].image).toMatchObject({ seed: 42, aspect: '1:1' });
        expect(h.records[0].record['attempts']).toEqual([
            { connection: 'oa', model: 'gpt-image-2', outcome: 'skipped', ms: 0, detail: 'takes no seed' },
            expect.objectContaining({ connection: 'mm', model: 'image-01', outcome: 'ok' }),
        ]);
        expect(r.ok).toBe(true);
    });

    it('sends a picture to edit only to a model that edits', async () => {
        live([MM, GM]);
        const asked = painters();
        await askAi({ purpose: 'edit', input: ['make it blue', { bytes: PNG, mimeType: 'image/png' }] });
        expect(asked.map((a) => a.model)).toEqual(['gemini:gemini-nano-banana-2.1']);
        expect(asked[0].parts).toHaveLength(1);
    });

    it('counts MiniMax pictures under their own limit a minute, unless the admin set the connection\'s', async () => {
        live([MM]);
        painters();
        await askAi({ purpose: 'cover', input: 'fruit' });
        expect(h.paced[0]).toEqual(['mm~image', { perMinute: 10, atOnce: null }]);
        live([{ connection: 'mm2', model: 'image-01' }]);
        await askAi({ purpose: 'cover', input: 'fruit' });
        expect(h.paced[1]).toEqual(['mm2', { perMinute: 30, atOnce: null }]);
    });

    it('keeps the Media Manager\'s pictures in ai-files/, never the purpose\'s saveTo', async () => {
        live([OA]);
        painters();
        const own = await askAi({ purpose: 'cover', input: 'fruit' });
        expect(own.ok && own.files?.[0].path).toMatch(/^app\/covers\//);
        const tab = await askAiForArc({ purpose: 'cover', input: 'fruit' }, { only: OA, ignoreSaveTo: true });
        expect(tab.ok && tab.files?.[0].path).toMatch(/^ai-files\/cover\//);
    });

    it('gives back the allowance of pictures asked for and not made', async () => {
        live([GM]);
        painters({ gemini: made(2) });
        const r = await askAi({ purpose: 'counted', input: 'fruit', limitKey: 'admin-1', image: { count: 4 } });
        expect(h.consumed).toEqual([4]);
        expect(h.released).toEqual([2]);
        expect(r.ok && r.image).toMatchObject({ count: 4, aspect: '1:1' });
    });

    it('prices a high gpt-image-2 picture at its pixels, four times the standard', async () => {
        live([OA]);
        painters();
        const r = await askAi({ purpose: 'cover', input: 'fruit', image: { resolution: 'high' } });
        expect((r as { usage: { costUsd: number } }).usage.costUsd).toBeCloseTo(0.211 * 4, 9);
    });

    it('puts every kind on one counter once the admin sets either of the connection\'s limits', async () => {
        live([{ connection: 'mm3', model: 'image-01' }], { connections: { mm3: { preset: 'minimax', atOnce: 2 } } });
        painters();
        await askAi({ purpose: 'cover', input: 'fruit' });
        expect(h.paced[0]).toEqual(['mm3', { perMinute: 60, atOnce: 2 }]);
    });

    it('refuses a negative prompt that is not text, or too long', async () => {
        live([OA]);
        await expect(askAi({ purpose: 'cover', input: 'x', image: { negativePrompt: 'n'.repeat(1001) } })).rejects.toThrow('at most 1,000 characters');
    });
});
