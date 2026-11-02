/**
 * askAi for the kinds that make files, and what AM1 added to every call
 * (specs/ai-media-spec.md, AM-D1, AM-D4, AM-D9, AM-D11, AM-D15, AM-D16, AM-D23, AM-D31,
 * AM-D32). Providers are fake connectors: no file connector ships in AM1, so a fake one
 * stands for the providers of AM2 to AM5. Firestore and Storage are mocked at their modules.
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
}));

vi.mock('../custom/ai.js', () => ({
    AI_PURPOSES: {
        cover: { label: 'Cover', makes: 'image', instruction: 'Flat illustration.', image: { aspect: '16:9', count: 2 }, perKeyPerDay: 10, allowanceIn: 'pictures', saveTo: 'app/covers', cache: true },
        voice: { label: 'Voice', makes: 'speech', input: { text: { maxChars: 500 } }, perKeyPerDay: 1000, allowanceIn: 'characters' },
        clip: { label: 'Clip', makes: 'video', video: { seconds: 4 } },
        one: { label: 'One', makes: 'image', fallback: false },
        nope: { label: 'Nope', makes: 'image', testAnswer: { aiTestFailure: 'blocked' } },
        ask: { label: 'Ask', instruction: 'Answer.' },
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
    noteConnection: async () => undefined,
    alertOutOfCredit: async (id: string) => void h.credit.push(id),
}));
vi.mock('../ai/limits.js', () => ({
    consumeAllowance: async (_p: string, _k: string, units: number) => (h.consumed.push(units), { ok: true, release: async () => undefined }),
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
vi.mock('../ai/pacing.js', () => ({ waitForPlace: async () => (h.place.ok ? { ok: true, release: async () => undefined } : { ok: false, wait: h.place.wait }) }));

import { askAi, captureAiAsks } from '../ai/askAi.js';
import { replaceConnectorsForTest, replaceFileConnectorsForTest } from '../ai/connectors/index.js';
import type { Connector, FileConnector, FileResult } from '../ai/connectors/types.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function live(extra: Record<string, unknown> = {}) {
    h.settings = {
        mode: 'live',
        connections: { oa: { preset: 'openai' }, oa2: { preset: 'openai-eu' }, claude: { preset: 'anthropic' } },
        lists: { image: [{ connection: 'oa', model: 'pic-1' }, { connection: 'oa2', model: 'pic-2' }] },
        models: {
            'oa/pic-1': { makes: 'image', unit: 'pictures', price: 0.04 },
            'oa2/pic-2': { makes: 'image', unit: 'pictures', price: 0.05 },
            'oa/talk': { makes: 'text' },
        },
        tiers: { fast: [{ connection: 'claude', model: 'claude-sonnet-5-5' }] },
        ...extra,
    };
}

function makes(...results: FileResult[]): ReturnType<typeof vi.fn> {
    const fn = vi.fn<FileConnector>(async () => results.shift() ?? { ok: false, failure: 'unavailable', detail: 'no more answers' });
    replaceFileConnectorsForTest({ openai: fn as unknown as FileConnector });
    return fn;
}

const twoPictures: FileResult = { ok: true, files: [{ bytes: PNG, mimeType: 'image/png', width: 1536, height: 864 }, { bytes: PNG, mimeType: 'image/png', width: 1536, height: 864 }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 } };

beforeEach(() => {
    h.settings = {};
    h.records = [];
    h.totals = [];
    h.consumed = [];
    h.budgetChecks = 0;
    h.saved = new Map();
    h.copied = [];
    h.cacheHit = null;
    h.cacheLookups = 0;
    h.cacheStored = [];
    h.place = { ok: true };
    h.credit = [];
    h.copyFails = false;
    h.saveFails = false;
});
afterEach(() => {
    replaceFileConnectorsForTest({});
    replaceConnectorsForTest({});
});

describe('a developer\'s mistakes throw', () => {
    it('names a saveAs without the purpose\'s folder or outside it, and settings for another kind', async () => {
        await expect(askAi({ purpose: 'voice', input: 'Hi', limitKey: 'k', saveAs: 'app/a.mp3' })).rejects.toThrow('saveAs needs the purpose\'s saveTo folder');
        await expect(askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k', saveAs: 'app/elsewhere/a.png' })).rejects.toThrow('must be inside cover\'s folder, app/covers/');
        await expect(askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k', saveAs: 'app/covers/../users/a.png' })).rejects.toThrow('plain path');
        await expect(askAi({ purpose: 'ask', input: 'Hi', saveAs: 'app/covers/a.png' })).rejects.toThrow('saveAs is for a purpose that makes files');
        await expect(askAi({ purpose: 'voice', input: 'Hi', limitKey: 'k', image: { count: 1 } })).rejects.toThrow('image settings are for a purpose that makes image');
        await expect(askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k', image: { count: 5 } })).rejects.toThrow('image.count must be a whole number from 1 to 4');
    });
});

describe('test mode', () => {
    it('saves grey stand-ins in the test folder, never the app\'s, and counts the allowance in pictures', async () => {
        const r = await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'site', saveAs: 'app/covers/a1/hero.png' });
        expect(r).toMatchObject({ ok: true, recordId: 'rec1', usage: { kind: 'image', test: true, costUsd: 0 } });
        const files = (r as { files: Array<{ path: string; width: number; height: number; mimeType: string }> }).files;
        expect(files.map((f) => f.path)).toEqual(['ai-files/_test/cover/' + new Date().toISOString().slice(0, 7) + '/rec1-1.png', 'ai-files/_test/cover/' + new Date().toISOString().slice(0, 7) + '/rec1-2.png']);
        expect(files[0]).toMatchObject({ mimeType: 'image/png', width: 1368, height: 768 });
        expect([...h.saved.keys()].every((p) => p.startsWith('ai-files/_test/'))).toBe(true);
        expect(h.consumed).toEqual([2]);
        expect(h.records[0]).toMatchObject({ id: 'rec1', record: { kind: 'image', test: true, filePaths: files.map((f) => f.path) } });
        // Test mode never reads or writes the cache, and checks no budget.
        expect(h.cacheLookups).toBe(0);
        expect(h.budgetChecks).toBe(0);
    });

    it('gives silence for speech, counting the allowance in characters, a grey clip for video, and a test failure', async () => {
        const speech = await askAi({ purpose: 'voice', input: 'x'.repeat(45), limitKey: 'k' });
        expect((speech as { files: Array<{ mimeType: string; seconds: number }> }).files[0]).toMatchObject({ mimeType: 'audio/wav', seconds: 3 });
        expect(h.consumed).toEqual([45]);
        expect((await askAi({ purpose: 'clip', input: 'A wave' }) as { files: Array<{ mimeType: string }> }).files[0].mimeType).toBe('video/mp4');
        expect(await askAi({ purpose: 'nope', input: 'x' })).toMatchObject({ ok: false, reason: 'blocked' });
        expect(await askAi({ purpose: 'clip' })).toMatchObject({ ok: false, reason: 'unreadable', detail: expect.stringContaining('no text') });
    });

    it('in captureAiAsks, answers with stand-in paths and writes nothing', async () => {
        const ai = captureAiAsks();
        try {
            const r = await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k' });
            expect((r as { files: Array<{ path: string }> }).files[0].path).toContain('ai-files/_test/cover/');
            expect(ai.asks[0]).toMatchObject({ purpose: 'cover', text: ['A cat'] });
            expect(h.saved.size).toBe(0);
            expect(h.records).toEqual([]);
        } finally {
            ai.stop();
        }
    });
});

describe('live', () => {
    it('answers off while no connector makes the kind, such as pictures on OpenRouter', async () => {
        live({ connections: { or: { preset: 'openrouter' } }, lists: { image: [{ connection: 'or', model: 'pic' }] }, models: { 'or/pic': { makes: 'image', unit: 'pictures' } } });
        expect(await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k' })).toMatchObject({ ok: false, reason: 'off', detail: expect.stringContaining('Arc cannot make image with OpenRouter yet') });
    });

    it('saves what a model made at the call\'s path, prices it per picture and keeps it for the cache', async () => {
        live();
        const fn = makes(twoPictures);
        const r = await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k', saveAs: 'app/covers/a1/hero.png' });
        expect(r).toMatchObject({ ok: true, usage: { kind: 'image', amount: 2, unit: 'pictures', test: false } });
        expect((r as { usage: { costUsd: number } }).usage.costUsd).toBeCloseTo(0.08, 10);
        expect((r as { files: Array<{ path: string }> }).files.map((f) => f.path)).toEqual(['app/covers/a1/hero.png', 'app/covers/a1/hero-2.png']);
        expect(fn.mock.calls[0][1]).toMatchObject({ kind: 'image', model: 'pic-1', prompt: 'A cat\n\nFlat illustration.', image: { aspect: '16:9', count: 2 } });
        expect(h.cacheStored[0]).toMatchObject({ files: [{ path: 'app/covers/a1/hero.png', width: 1536 }, { path: 'app/covers/a1/hero-2.png' }], recordId: 'rec1', connection: 'oa', model: 'pic-1', days: 365 });
        expect(h.records[0].record).toMatchObject({ costFrom: 'price-list', amount: 2, unit: 'pictures' });
    });

    it('answers a cache hit with no call, no allowance, no budget and a record marked cached', async () => {
        live();
        const fn = makes(twoPictures);
        h.cacheHit = { paths: ['ai-files/_cache/cover/h-1.png'], files: [{ mimeType: 'image/png', bytes: 4, width: 1536, height: 864 }], recordId: 'first' };
        const r = await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k', saveAs: 'app/covers/a2/hero.png' });
        expect(r).toMatchObject({ ok: true, cached: true, usage: { costUsd: 0 } });
        // Copied from the cache's own copy, with the file's shape as a fresh answer gives it.
        expect((r as { files: unknown[] }).files).toEqual([{ path: 'app/covers/a2/hero.png', mimeType: 'image/png', bytes: 4, width: 1536, height: 864 }]);
        expect(h.copied).toEqual([['ai-files/_cache/cover/h-1.png', 'app/covers/a2/hero.png']]);
        expect(fn).not.toHaveBeenCalled();
        expect(h.consumed).toEqual([]);
        expect(h.budgetChecks).toBe(0);
        expect(h.records[0].record).toMatchObject({ cached: true, cachedFrom: 'first', costUsd: 0 });
    });

    it('takes a hit whose file cannot be copied as a miss, and makes the file again', async () => {
        live();
        const fn = makes(twoPictures);
        h.cacheHit = { paths: ['ai-files/_cache/cover/gone-1.png'], files: [{ mimeType: 'image/png', bytes: 4 }], recordId: 'first' };
        h.copyFails = true;
        const r = await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k', saveAs: 'app/covers/a3/hero.png' });
        expect(r).toMatchObject({ ok: true });
        expect(r).not.toHaveProperty('cached');
        expect(fn).toHaveBeenCalledTimes(1);
        expect(h.consumed).toEqual([2]);
    });

    it('fails, keeps the units and records the cost when a billed file cannot be saved', async () => {
        live();
        makes(twoPictures);
        h.saveFails = true;
        expect(await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k' })).toMatchObject({ ok: false, reason: 'unavailable', detail: expect.stringContaining('could not be saved') });
        expect(h.consumed).toEqual([2]);
        expect(h.records[0].record).toMatchObject({ outcome: 'unavailable', amount: 2, costFrom: 'price-list' });
        expect(h.records[0].record['costUsd']).toBeCloseTo(0.08, 10);
    });

    it('checks a call\'s own settings as it checks the purpose\'s', async () => {
        await expect(askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k', image: { resolution: 'huge' as never } })).rejects.toThrow("image.resolution must be 'standard' or 'high'");
        await expect(askAi({ purpose: 'voice', input: 'Hi', limitKey: 'k', speech: { language: 'English' } })).rejects.toThrow('speech.language must be a language tag');
    });

    it('does not look in the cache when the admin switched it off', async () => {
        live({ purposes: { cover: { cache: false } } });
        makes(twoPictures);
        await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k' });
        expect(h.cacheLookups).toBe(0);
        expect(h.cacheStored).toEqual([]);
    });

    it('falls back to the next model when one is busy, and never with fallback: false', async () => {
        live();
        const fn = makes({ ok: false, failure: 'unavailable', detail: 'busy' }, twoPictures);
        expect(await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k' })).toMatchObject({ ok: true, usage: { model: 'pic-2' } });
        expect(fn).toHaveBeenCalledTimes(2);
        const one = makes({ ok: false, failure: 'unavailable', detail: 'busy' }, twoPictures);
        expect(await askAi({ purpose: 'one', input: 'A cat' })).toMatchObject({ ok: false, reason: 'unavailable' });
        expect(one).toHaveBeenCalledTimes(1);
    });

    it('waits on a connection at its limit, then tries the next model, and says so', async () => {
        live();
        h.place = { ok: false, wait: 30 };
        makes(twoPictures);
        expect(await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k' })).toMatchObject({ ok: false, reason: 'unavailable', wait: 30, detail: expect.stringContaining('at its limit of requests') });
    });

    it('tries the same model once more after a short "too many requests", and tells admins when credit is gone', async () => {
        live();
        vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
        try {
            const fn = makes({ ok: false, failure: 'unavailable', detail: '429', rateLimited: true, wait: 1 }, twoPictures);
            expect(await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k' })).toMatchObject({ ok: true, usage: { model: 'pic-1' } });
            expect(fn).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
        makes({ ok: false, failure: 'unavailable', detail: 'no credit', outOfCredit: true }, twoPictures);
        expect(await askAi({ purpose: 'cover', input: 'A dog', limitKey: 'k' })).toMatchObject({ ok: true, usage: { model: 'pic-2' } });
        expect(h.credit).toEqual(['oa']);
    });

    it('offers only models that make the kind: a text model in the image list is left out', async () => {
        live({ lists: { image: [{ connection: 'oa', model: 'talk' }] } });
        expect(await askAi({ purpose: 'cover', input: 'A cat', limitKey: 'k' })).toMatchObject({ ok: false, reason: 'off', detail: 'no model in the image list makes image' });
    });

    it('prices a text call\'s cached input as the provider bills it', async () => {
        live();
        replaceConnectorsForTest({ anthropic: (async () => ({ ok: true, text: 'Yes.', usage: { tokensIn: 1_000_000, tokensOut: 0, tokensThinking: 0, tokensCached: 1_000_000 } })) as Connector });
        const r = await askAi({ purpose: 'ask', input: 'Is it?' });
        expect(r).toMatchObject({ ok: true, text: 'Yes.', usage: { kind: 'text', unit: 'tokens', tokensCached: 1_000_000 } });
        // Sonnet 5.5 reads from cache at 0.20 a million, not its 2.00 input price.
        expect((r as { usage: { costUsd: number } }).usage.costUsd).toBeCloseTo(0.2, 10);
    });
});
