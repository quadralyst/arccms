/**
 * The generic core of AM1 (specs/ai-media-spec.md): cost by unit with cached input
 * (AM-D5, AM-D31), the purpose checks for the new fields (AM-D1, AM-D9, AM-D16, AM-D19,
 * AM-D23), where files go (AM-D9, AM-D11), the stand-in files (AM-D11), the cache key
 * (AM-D16), pacing (AM-D15) and balances (AM-D32).
 */
import { inflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    pacing: {} as Record<string, unknown>,
    settingsDoc: {} as Record<string, unknown>,
    updates: [] as Array<Record<string, unknown>>,
    notified: [] as Array<{ type: string; title: string }>,
}));

vi.mock('../init', () => ({
    owner: {},
    storage: {},
    db: {
        collection: (name: string) => ({
            doc: (id: string) => ({
                id,
                get: async () => ({ exists: true, data: () => (name === 'Settings' ? h.settingsDoc : h.pacing) }),
                update: async (u: Record<string, unknown>) => void h.updates.push(u),
            }),
        }),
        runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
            get: async () => ({ data: () => h.pacing }),
            set: (_ref: unknown, value: Record<string, unknown>) => void (h.pacing = value),
        }),
    },
}));
vi.mock('../email-core/adminAlerts.js', () => ({ notifyAdmins: async (type: string, p: { title: string }) => void h.notified.push({ type, title: p.title }) }));
vi.mock('../ai/keys.js', () => ({ readKey: async () => ({ ok: true, key: 'sk-12345678' }) }));
vi.mock('../custom/ai.js', () => ({ AI_PURPOSES: {} }));

import { attemptCost, tokenCost } from '../ai/cost.js';
import { purposeProblems, purposeKind, purposeCacheDays } from '../ai/purposes.js';
import { storagePathProblem, isAiFilePath } from '../ai/paths.js';
import { filePaths, nthPath } from '../ai/files.js';
import { greyPng, pictureSize, silentWav, standInFiles, testSpeechSeconds } from '../ai/standins.js';
import { cacheHash } from '../ai/cache.js';
import { minuteOf, tryPlace, waitForPlace } from '../ai/pacing.js';
import { readDeepSeekBalance, readOpenRouterKey, refreshBalance } from '../ai/balances.js';
import { modelInfo, resolveAiSettings, type AiModelInfo } from '../ai/settings.js';

const tokens = (over: Partial<AiModelInfo> = {}): AiModelInfo => ({ makes: 'text', unit: 'tokens', reads: [], schema: 'json', priceIn: 2, priceOut: 10, currency: 'USD', usdRate: 1, testedLive: true, ...over });

describe('cost', () => {
    it('prices cached reads and cache writes apart from the rest of the input', () => {
        const info = tokens({ priceCachedIn: 0.2, priceCacheWrite: 2.5 });
        // 1M input: 600K cached, 100K written, 300K plain; 100K out.
        const usd = tokenCost(info, { tokensIn: 1_000_000, tokensOut: 100_000, tokensThinking: 0, tokensCached: 600_000, tokensCacheWrite: 100_000 });
        expect(usd).toBeCloseTo(0.3 * 2 + 0.6 * 0.2 + 0.1 * 2.5 + 0.1 * 10, 10);
    });

    it('counts a missing cached price at the input price, and the higher price above a prompt size', () => {
        expect(tokenCost(tokens(), { tokensIn: 1_000_000, tokensOut: 0, tokensThinking: 0, tokensCached: 1_000_000 })).toBeCloseTo(2, 10);
        const haiku = modelInfo(resolveAiSettings({ connections: { c: { preset: 'anthropic' } } }), { connection: 'c', model: 'claude-haiku-5-5' });
        expect(tokenCost(haiku, { tokensIn: 100_000, tokensOut: 0, tokensThinking: 0 })).toBeCloseTo(0.01, 10);
        expect(tokenCost(haiku, { tokensIn: 200_000, tokensOut: 0, tokensThinking: 0 })).toBeCloseTo(0.1, 10);
    });

    it('takes the provider\'s own figure first, prices other units per picture, per 1,000 characters and per second', () => {
        expect(attemptCost(tokens(), { tokensIn: 10, tokensOut: 10, tokensThinking: 0, costUsd: 0.5 })).toMatchObject({ usd: 0.5, from: 'provider', unit: 'tokens', amount: 20 });
        expect(attemptCost(tokens({ unit: 'pictures', price: 0.04 }), { tokensIn: 0, tokensOut: 0, tokensThinking: 0 }, 3)).toMatchObject({ usd: 0.12, from: 'price-list', amount: 3, unit: 'pictures' });
        expect(attemptCost(tokens({ unit: 'characters', price: 0.08 }), { tokensIn: 0, tokensOut: 0, tokensThinking: 0 }, 2500).usd).toBeCloseTo(0.2, 10);
        expect(attemptCost(tokens({ unit: 'seconds', price: 0.1 }), { tokensIn: 0, tokensOut: 0, tokensThinking: 0, amount: 8 }, 5)).toMatchObject({ amount: 8 });
        expect(attemptCost(tokens({ unit: 'seconds' }), { tokensIn: 0, tokensOut: 0, tokensThinking: 0 }, 5)).toMatchObject({ usd: 0, from: 'none' });
    });

    it('needs the admin\'s rate for a price in another currency, and counts 0 until then', () => {
        const s = resolveAiSettings({ connections: { s: { preset: 'sarvam' }, r: { preset: 'sarvam', usdRate: 0.012 } } });
        const usage = { tokensIn: 1_000_000, tokensOut: 0, tokensThinking: 0 };
        expect(attemptCost(modelInfo(s, { connection: 's', model: 'sarvam-105b' }), usage)).toMatchObject({ usd: 0, from: 'none' });
        expect(attemptCost(modelInfo(s, { connection: 'r', model: 'sarvam-105b' }), usage).usd).toBeCloseTo(15 * 0.012, 10);
    });

    it('drops Arc\'s higher price above a prompt size once the admin sets a price', () => {
        const s = resolveAiSettings({ connections: { c: { preset: 'anthropic' } }, models: { 'c/claude-haiku-5-5': { priceIn: 1, priceOut: 1 } } });
        expect(modelInfo(s, { connection: 'c', model: 'claude-haiku-5-5' })).toMatchObject({ priceIn: 1, priceAbove: undefined, priceCachedIn: undefined, testedLive: false });
    });
});

describe('purpose checks', () => {
    it('know what a purpose makes, and take a file purpose without an instruction', () => {
        expect(purposeKind({ label: 'a', instruction: 'x' })).toBe('text');
        expect(purposeKind({ label: 'a', instruction: 'x', output: { schema: { type: 'object' } } })).toBe('data');
        expect(purposeProblems({ cover: { label: 'Cover', makes: 'image', image: { aspect: '16:9', count: 2 }, saveTo: 'app/covers', cache: true, deleteAfterDays: 7, allowanceIn: 'pictures' } })).toEqual([]);
        expect(purposeCacheDays({ label: 'a', cache: true })).toBe(365);
        expect(purposeCacheDays({ label: 'a', cache: { days: 30 } })).toBe(30);
    });

    it('name every mistake in the new fields', () => {
        const problems = purposeProblems({
            a: { label: 'A', makes: 'pictures' },
            b: { label: 'B', makes: 'image', output: { schema: { type: 'object' } }, image: { count: 9, aspect: '5:4' } },
            c: { label: 'C', instruction: 'x', saveTo: 'app/x', cache: true, deleteAfterDays: 3, image: { count: 1 } },
            d: { label: 'D', makes: 'speech', saveTo: 'ai-files/mine', allowanceIn: 'pictures', speech: { speed: 3 } },
            e: { label: 'E', makes: 'video', cache: { days: 0 }, audio: { seconds: 2 }, fallback: 'no' },
            f: { label: 'F', makes: 'data', instruction: 'x' },
        });
        const text = problems.join('\n');
        for (const words of [
            'purpose "a": makes must be one of',
            'purpose "b": a purpose that makes image answers with files, so it takes no output',
            'image.count must be a whole number from 1 to 4',
            'image.aspect must be one of',
            'purpose "c": saveTo is for a purpose that makes files',
            'purpose "c": deleteAfterDays is for a purpose that makes files',
            'purpose "c": cache is for a purpose that makes files',
            'purpose "c": image settings belong to a purpose that makes image',
            'purpose "d": saveTo "ai-files/mine" is in ai-files/',
            'allowanceIn \'pictures\' is for a purpose that makes pictures',
            'speech.speed must be from 0.5 to 2',
            'purpose "e": cache must be true, false or { days }',
            'purpose "e": audio settings belong to a purpose that makes audio',
            'purpose "e": fallback must be true or false',
            'purpose "f": a purpose that makes data needs output: { schema }',
        ]) expect(text).toContain(words);
    });
});

describe('where files go', () => {
    it('refuses paths outside the bucket or in Arc\'s own folders, at either of the first two levels', () => {
        expect(storagePathProblem('app/audio', 'saveTo')).toBeNull();
        for (const bad of ['/app', 'gs://b/app', 'app/../x', 'app//x', 'ai-calls/x', 'arccms/ai-files/x', 'users/u1', 'mediaImages', 'arccms/mediaFiles/x']) {
            expect(storagePathProblem(bad, 'saveTo')).not.toBeNull();
        }
        expect(isAiFilePath('ai-files/cover/2026-11/a-1.png')).toBe(true);
        expect(isAiFilePath('ai-calls/r/1.png')).toBe(true);
        expect(isAiFilePath('app/x.png')).toBe(false);
    });

    it('names files by the record, in Arc\'s folder, the app\'s, at the call\'s path, and test files apart', () => {
        const files = [{ bytes: Buffer.alloc(1), mimeType: 'image/png' }, { bytes: Buffer.alloc(1), mimeType: 'image/png' }];
        expect(filePaths({ recordId: 'r1', purpose: 'cover', month: '2026-11', test: false, files })).toEqual(['ai-files/cover/2026-11/r1-1.png', 'ai-files/cover/2026-11/r1-2.png']);
        expect(filePaths({ recordId: 'r1', purpose: 'cover', month: '2026-11', test: false, saveTo: 'app/covers/', files })).toEqual(['app/covers/r1-1.png', 'app/covers/r1-2.png']);
        expect(filePaths({ recordId: 'r1', purpose: 'cover', month: '2026-11', test: false, saveTo: 'app/covers', saveAs: 'app/covers/a1/hero.png', files })).toEqual(['app/covers/a1/hero.png', 'app/covers/a1/hero-2.png']);
        expect(filePaths({ recordId: 'r1', purpose: 'cover', month: '2026-11', test: true, saveTo: 'app/covers', saveAs: 'app/covers/a1/hero.png', files: files.slice(0, 1) })).toEqual(['ai-files/_test/cover/2026-11/r1-1.png']);
        expect(nthPath('a/b', 3)).toBe('a/b-3');
    });
});

describe('stand-in files', () => {
    it('makes a grey PNG of the asked size, a few KB', () => {
        expect(pictureSize({ aspect: '16:9' })).toEqual({ width: 1368, height: 768 });
        expect(pictureSize({ resolution: 'high' })).toEqual({ width: 2048, height: 2048 });
        const png = greyPng(64, 32);
        expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        expect(png.readUInt32BE(16)).toBe(64);
        expect(png.readUInt32BE(20)).toBe(32);
        const idat = png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 8);
        expect(inflateSync(idat).length).toBe((64 + 1) * 32);
        expect(greyPng(1024, 1024).length).toBeLessThan(10_000);
    });

    it('makes silence as WAV, a second for every 15 characters of speech, at most 10, and a short grey video', () => {
        const wav = silentWav(2);
        expect(wav.subarray(0, 4).toString()).toBe('RIFF');
        expect(wav.length).toBe(44 + 2 * 8000 * 2);
        expect(testSpeechSeconds(1)).toBe(1);
        expect(testSpeechSeconds(46)).toBe(4);
        expect(testSpeechSeconds(10_000)).toBe(10);
        expect(standInFiles('image', { image: { count: 3 }, chars: 5 })).toHaveLength(3);
        expect(standInFiles('audio', { audioSeconds: 30, chars: 0 })[0]).toMatchObject({ mimeType: 'audio/wav', seconds: 10 });
        const [video] = standInFiles('video', { chars: 0 });
        expect(video).toMatchObject({ mimeType: 'video/mp4', seconds: 2 });
        expect(video.bytes.subarray(4, 8).toString()).toBe('ftyp');
        expect(video.bytes.length).toBeLessThan(50_000);
    });
});

describe('the cache key', () => {
    it('is the same for the same input and settings in any key order, and differs by model, settings or bytes', () => {
        const ref = { connection: 'c', model: 'm' };
        const parts = [{ kind: 'text' as const, text: 'A cat' }];
        const a = cacheHash('cover', ref, { image: { aspect: '1:1', count: 1 } }, 'style', parts);
        expect(cacheHash('cover', ref, { image: { count: 1, aspect: '1:1' } }, 'style', parts)).toBe(a);
        expect(cacheHash('cover', { connection: 'c', model: 'n' }, { image: { aspect: '1:1', count: 1 } }, 'style', parts)).not.toBe(a);
        expect(cacheHash('cover', ref, { image: { aspect: '16:9', count: 1 } }, 'style', parts)).not.toBe(a);
        const pic = (b: number) => [{ kind: 'picture' as const, mimeType: 'image/png', bytes: Buffer.from([b]), name: null, storagePath: null }];
        expect(cacheHash('cover', ref, {}, '', pic(1))).not.toBe(cacheHash('cover', ref, {}, '', pic(2)));
    });
});

describe('pacing', () => {
    beforeEach(() => {
        h.pacing = {};
    });

    it('lets requests through up to the minute\'s limit, then says how long until the next minute', async () => {
        const at = Date.parse('2026-11-02T10:00:30Z');
        expect(minuteOf(at)).toBe('202611021000');
        for (let i = 0; i < 2; i++) expect(await tryPlace('s', { perMinute: 2, atOnce: null }, at + 60_000, at)).toMatchObject({ ok: true });
        expect(await tryPlace('s', { perMinute: 2, atOnce: null }, at + 60_000, at)).toEqual({ ok: false, waitMs: 30_000 });
        // A new minute starts the count again.
        expect(await tryPlace('s', { perMinute: 2, atOnce: null }, at + 120_000, at + 31_000)).toMatchObject({ ok: true });
        expect(h.pacing['count']).toBe(1);
    });

    it('holds at most so many at once, and forgets a lease whose time ran out', async () => {
        const at = 1_000_000;
        expect(await tryPlace('e', { perMinute: null, atOnce: 1 }, at + 5000, at)).toMatchObject({ ok: true });
        expect(await tryPlace('e', { perMinute: null, atOnce: 1 }, at + 5000, at + 1000)).toEqual({ ok: false, waitMs: 4000 });
        expect(await tryPlace('e', { perMinute: null, atOnce: 1 }, at + 9000, at + 6000)).toMatchObject({ ok: true });
    });

    it('waits for a place while the call\'s time allows, and writes nothing without limits', async () => {
        expect(await waitForPlace('n', { perMinute: null, atOnce: null }, Date.now() + 1000)).toMatchObject({ ok: true });
        expect(h.pacing).toEqual({});
        let clock = 0;
        const slept: number[] = [];
        h.pacing = { minute: minuteOf(0), count: 5, leases: {} };
        const r = await waitForPlace('s', { perMinute: 5, atOnce: null }, 5_000, { now: () => clock, sleep: async (ms) => void (slept.push(ms), (clock += ms)) });
        // Three seconds were spent waiting, so the minute turns in 57.
        expect(r).toEqual({ ok: false, wait: 57 });
        expect(slept).toEqual([1000, 2000]);
    });
});

describe('balances', () => {
    beforeEach(() => {
        h.updates = [];
        h.notified = [];
        h.settingsDoc = { connections: { ds: { preset: 'deepseek' } } };
    });

    it('read DeepSeek\'s balance in USD when there is one, and an OpenRouter key\'s own limit', () => {
        expect(readDeepSeekBalance({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '70.5' }, { currency: 'USD', total_balance: '9.25' }] })).toEqual({ ok: true, balance: 9.25, unit: 'USD' });
        expect(readDeepSeekBalance({ balance_infos: [] })).toMatchObject({ ok: false });
        expect(readOpenRouterKey({ data: { limit: 10, limit_remaining: 4.5 } })).toEqual({ ok: true, balance: 4.5, unit: 'USD key limit' });
        expect(readOpenRouterKey({ data: { limit: null, limit_remaining: null } })).toEqual({ ok: true, balance: null, unit: 'USD key limit' });
    });

    it('stores the balance and tells admins once when it falls below the low mark', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ balance_infos: [{ currency: 'USD', total_balance: '1.50' }] }), { status: 200 })));
        const settings = resolveAiSettings({ connections: { ds: { preset: 'deepseek', label: 'DeepSeek', lowBalance: 5 } } });
        expect(await refreshBalance(settings.connections['ds'])).toEqual({ ok: true, balance: 1.5, unit: 'USD' });
        expect(h.updates[0]).toMatchObject({ 'connections.ds.balance': 1.5, 'connections.ds.balanceUnit': 'USD', 'connections.ds.balanceLowAlerted': true });
        expect(h.notified).toEqual([{ type: 'admin_ai_balance', title: 'DeepSeek: balance low' }]);
        expect(h.updates[0]).toMatchObject({ 'connections.ds.balanceAlertMark': 5 });
        // Already told about this mark: no second alert until the balance rises again.
        await refreshBalance({ ...settings.connections['ds'], balanceLowAlerted: true, balanceAlertMark: 5 });
        expect(h.notified).toHaveLength(1);
        // The admin raised the mark: told again.
        await refreshBalance({ ...settings.connections['ds'], lowBalance: 10, balanceLowAlerted: true, balanceAlertMark: 5 });
        expect(h.notified).toHaveLength(2);
        const fetchMock = vi.mocked(fetch);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://api.deepseek.com/user/balance');
        expect(init.headers).toMatchObject({ authorization: 'Bearer sk-12345678' });
        vi.unstubAllGlobals();
    });

    it('say plainly when a provider gives no balance to its key', async () => {
        const settings = resolveAiSettings({ connections: { g: { preset: 'groq' } } });
        expect(await refreshBalance(settings.connections['g'])).toMatchObject({ ok: false, detail: 'Groq gives no balance to its key' });
    });
});
