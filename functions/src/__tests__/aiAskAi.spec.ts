/**
 * askAi (specs/ai-spec.md, docs/app/ai.html): each reason a call can give, test mode, the
 * capture for unit tests, the fallback list, the allowance and the budget, and the record.
 * Providers are fake connectors; Firestore and Storage are mocked at their modules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonSchema } from '../ai/schema.js';

const h = vi.hoisted(() => ({
    settings: {} as Record<string, unknown>,
    records: [] as Array<{ record: Record<string, unknown>; content: unknown }>,
    totals: [] as Array<Record<string, unknown>>,
    allowance: { ok: true } as { ok: boolean; wait?: number },
    released: 0,
    budget: { ok: true } as { ok: boolean; wait?: number },
    keys: {} as Record<string, string>,
    files: new Map<string, Buffer>(),
    featureOn: true,
    menu: {
        type: 'object',
        properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number' } }, required: ['name', 'price'] } } },
        required: ['items'],
    } as JsonSchema,
}));

vi.mock('../custom/ai.js', () => ({
    AI_PURPOSES: {
        'menu-scan': {
            label: 'Menu scan',
            instruction: 'Read the menu.',
            input: { pictures: { max: 2, maxMb: 1 }, text: { maxChars: 100 } },
            output: { schema: h.menu },
            tier: 'thorough',
            perKeyPerDay: 20,
            testAnswer: { items: [{ name: 'Tea', price: 4.5 }] },
        },
        summary: { label: 'Summary', instruction: 'Summarise.', input: { pdfs: { max: 1, maxMb: 1 } } },
        blocked: { label: 'Blocked', instruction: 'x', testAnswer: { aiTestFailure: 'blocked', detail: 'test block' } },
    },
}));
vi.mock('../feature-flags.js', () => ({ isFeatureOn: (id: string) => (id === 'ai' ? h.featureOn : true) }));
vi.mock('../init', () => ({
    db: {},
    owner: {},
    storage: {
        bucket: () => ({
            file: (path: string) => ({
                getMetadata: async () => {
                    if (!h.files.has(path)) throw new Error('No such object');
                    return [{ size: String(h.files.get(path)!.length) }];
                },
                download: async () => [h.files.get(path)!],
            }),
        }),
    },
}));
vi.mock('../ai/settings.js', async (actual) => {
    const real = await actual<typeof import('../ai/settings.js')>();
    return { ...real, readAiSettings: async () => real.resolveAiSettings(h.settings) };
});
vi.mock('../ai/records.js', () => ({
    writeAiCall: async (record: Record<string, unknown>, content: unknown) => {
        h.records.push({ record, content });
        return `rec-${h.records.length}`;
    },
}));
vi.mock('../ai/usage.js', () => ({
    addToTotals: async (record: Record<string, unknown>) => void h.totals.push(record),
    noteConnection: async () => undefined,
}));
vi.mock('../ai/limits.js', () => ({
    consumeAllowance: async () => (h.allowance.ok ? { ok: true, release: async () => void h.released++ } : { ok: false, wait: h.allowance.wait }),
    checkBudget: async () => h.budget,
}));
vi.mock('../ai/keys.js', () => ({
    readKey: async (c: { id: string }) => (h.keys[c.id] ? { ok: true, key: h.keys[c.id] } : { ok: false, detail: `connection ${c.id} has no key` }),
}));

import { askAi, captureAiAsks } from '../ai/askAi.js';
import { replaceConnectorsForTest } from '../ai/connectors/index.js';
import type { Connector, ConnectorResult } from '../ai/connectors/types.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100)]);
const PDF = Buffer.from('%PDF-1.7 tiny');
const usage = { tokensIn: 1000, tokensOut: 200, tokensThinking: 0 };

function live(extra: Record<string, unknown> = {}) {
    h.settings = {
        mode: 'live',
        connections: { qwen: { preset: 'alibaba-eu', workspace: 'ws1' }, router: { preset: 'openrouter' } },
        tiers: { thorough: [{ connection: 'qwen', model: 'qwen3-vl-plus' }, { connection: 'router', model: 'qwen/qwen3-vl-plus' }], fast: [{ connection: 'router', model: 'text-only' }] },
        models: { 'router/qwen/qwen3-vl-plus': { reads: ['pictures'] } },
        ...extra,
    };
    h.keys = { qwen: 'sk-qwen-123456', router: 'sk-or-123456' };
}

function answers(...results: ConnectorResult[]): ReturnType<typeof vi.fn> {
    const fn = vi.fn<Connector>(async () => results.shift() ?? { ok: false, failure: 'unavailable', detail: 'no more answers' });
    replaceConnectorsForTest({ openai: fn as unknown as Connector });
    return fn;
}

beforeEach(() => {
    h.settings = {};
    h.records = [];
    h.totals = [];
    h.allowance = { ok: true };
    h.released = 0;
    h.budget = { ok: true };
    h.keys = {};
    h.files = new Map([['app/menus/b1/p1.jpg', JPEG]]);
    h.featureOn = true;
});
afterEach(() => replaceConnectorsForTest({}));

describe('a developer\'s mistakes throw', () => {
    it('names an unknown purpose, a kind the purpose does not take and a missing limitKey', async () => {
        await expect(askAi({ purpose: 'nope' })).rejects.toThrow('no purpose "nope" in functions/src/custom/ai.ts');
        await expect(askAi({ purpose: 'menu-scan' })).rejects.toThrow('every call needs a limitKey');
        await expect(askAi({ purpose: 'menu-scan', limitKey: 'b1', input: { bytes: PDF, mimeType: 'application/pdf' } })).rejects.toThrow('takes no PDFs');
        await expect(askAi({ purpose: 'summary', input: [{ storagePath: '../secret.pdf' }] })).rejects.toThrow('without /, . or .. parts');
        await expect(askAi({ purpose: 'summary', input: [{ storagePath: 'gs://other-bucket/x.pdf' }] })).rejects.toThrow('not in the project\'s bucket');
        await expect(askAi({ purpose: 'summary', units: 0 })).rejects.toThrow('units must be a whole number');
        await expect(askAi({ purpose: 'summary', input: [42 as unknown as string] })).rejects.toThrow('input part 1 must be');
    });
});

describe('off', () => {
    it('answers off, without throwing, when the feature is off', async () => {
        h.featureOn = false;
        const r = await askAi({ purpose: 'summary', input: 'hi' });
        expect(r).toMatchObject({ ok: false, reason: 'off', recordId: null });
        expect(h.records).toEqual([]);
    });

    it('answers off when the admin switched the purpose off, or no model is set', async () => {
        live({ purposes: { summary: { enabled: false } } });
        expect(await askAi({ purpose: 'summary', input: 'hi' })).toMatchObject({ ok: false, reason: 'off', detail: 'summary is switched off in Settings, AI' });
        live({ tiers: {} });
        expect(await askAi({ purpose: 'summary', input: 'hi' })).toMatchObject({ ok: false, reason: 'off', detail: 'no model is set for the fast tier in Settings, AI' });
        expect(h.records.map((r) => r.record['outcome'])).toEqual(['off', 'off']);
    });
});

describe('test mode', () => {
    it('answers from the purpose\'s test answer, spends nothing and keeps a record', async () => {
        const send = answers();
        const r = await askAi({ purpose: 'menu-scan', limitKey: 'b1', input: [{ storagePath: 'app/menus/b1/p1.jpg' }], ref: 'businesses/b1/scans/s1' });
        expect(r).toMatchObject({ ok: true, data: { items: [{ name: 'Tea', price: 4.5 }] }, usage: { test: true, costUsd: 0 }, recordId: 'rec-1' });
        expect(send).not.toHaveBeenCalled();
        expect(h.records[0].record).toMatchObject({ purpose: 'menu-scan', test: true, outcome: 'ok', ref: 'businesses/b1/scans/s1', limitKey: 'b1', input: { files: 1, bytes: JPEG.length } });
        expect(h.records[0].content).toBeNull();
    });

    it('builds a text answer when the purpose gives none, and stands for a failure', async () => {
        expect(await askAi({ purpose: 'summary', input: 'hi' })).toMatchObject({ ok: true, text: 'Test answer for Summary.' });
        expect(await askAi({ purpose: 'blocked' })).toMatchObject({ ok: false, reason: 'blocked', detail: 'test block' });
    });
});

describe('captureAiAsks', () => {
    it('records each call for a unit test, without Firestore or Storage', async () => {
        const ai = captureAiAsks({ answers: { summary: 'A short summary.' } });
        try {
            expect(await askAi({ purpose: 'summary', input: ['Notes', { storagePath: 'app/docs/x.pdf' }] })).toMatchObject({ ok: true, text: 'A short summary.', recordId: null });
            expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1', input: { bytes: JPEG, mimeType: 'image/jpeg', name: 'p1.jpg' } })).toMatchObject({ ok: true, data: { items: [{ name: 'Tea', price: 4.5 }] } });
            expect(ai.asks).toEqual([
                { purpose: 'summary', text: ['Notes'], files: [{ mimeType: 'application/pdf', bytes: 0, name: null, storagePath: 'app/docs/x.pdf' }], limitKey: null, units: 1, ref: null },
                { purpose: 'menu-scan', text: [], files: [{ mimeType: 'image/jpeg', bytes: JPEG.length, name: 'p1.jpg', storagePath: null }], limitKey: 'b1', units: 1, ref: null },
            ]);
            expect(h.records).toEqual([]);
        } finally {
            ai.stop();
        }
    });
});

describe('too-large and unreadable input', () => {
    it('refuses too much text, too many or too large files, and a file that is not what it says', async () => {
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1', input: 'x'.repeat(101) })).toMatchObject({ ok: false, reason: 'too-large' });
        const three = Array.from({ length: 3 }, () => ({ bytes: JPEG, mimeType: 'image/jpeg' }));
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1', input: three })).toMatchObject({ ok: false, reason: 'too-large', detail: '3 pictures; menu-scan takes at most 2' });
        const big = Buffer.concat([JPEG, Buffer.alloc(1024 * 1024)]);
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1', input: { bytes: big, mimeType: 'image/jpeg' } })).toMatchObject({ ok: false, reason: 'too-large' });
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1', input: { bytes: PDF, mimeType: 'image/jpeg' } })).toMatchObject({ ok: false, reason: 'unreadable', detail: 'part 1 is not a JPEG, PNG or WebP picture' });
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1', input: { storagePath: 'app/menus/gone.jpg' } })).toMatchObject({ ok: false, reason: 'unreadable', detail: 'app/menus/gone.jpg was not found' });
        // A refused call gives its allowance back.
        expect(h.released).toBe(5);
    });
});

describe('limits', () => {
    it('stops a key that has used its allowance, and the month whose budget is spent', async () => {
        h.allowance = { ok: false, wait: 3600 };
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1' })).toMatchObject({ ok: false, reason: 'limit', scope: 'key', wait: 3600 });
        h.allowance = { ok: true };
        live();
        h.budget = { ok: false, wait: 86_400 };
        const send = answers();
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1' })).toMatchObject({ ok: false, reason: 'limit', scope: 'budget', wait: 86_400 });
        expect(send).not.toHaveBeenCalled();
    });
});

describe('live calls', () => {
    it('answers with checked data, the tokens and the cost from the price list', async () => {
        live();
        const send = answers({ ok: true, text: '```json\n{"items":[{"name":"Tea","price":4.5}]}\n```', usage });
        const r = await askAi({ purpose: 'menu-scan', limitKey: 'b1', input: ['Prices in CHF', { storagePath: 'app/menus/b1/p1.jpg' }] });
        expect(r).toMatchObject({ ok: true, data: { items: [{ name: 'Tea', price: 4.5 }] }, usage: { model: 'qwen3-vl-plus', connection: 'qwen', tokensIn: 1000, tokensOut: 200, test: false } });
        expect(r.usage.costUsd).toBeCloseTo((1000 * 0.2 + 200 * 1.6) / 1e6, 10);
        const request = send.mock.calls[0][1];
        expect(request.instruction).toContain('Answer with JSON only');
        expect(request.parts.map((p: { kind: string }) => p.kind)).toEqual(['text', 'picture']);
        expect(h.records[0].record).toMatchObject({ outcome: 'ok', costFrom: 'price-list', attempts: [{ connection: 'qwen', model: 'qwen3-vl-plus', outcome: 'ok' }] });
        expect(h.totals).toHaveLength(1);
    });

    it('tries the next model when one is busy, retired or has no key, never after a block', async () => {
        live();
        answers({ ok: false, failure: 'unavailable', detail: '503', wait: 5 }, { ok: true, text: '{"items":[]}', usage, });
        const r = await askAi({ purpose: 'menu-scan', limitKey: 'b1', input: { bytes: JPEG, mimeType: 'image/jpeg' } });
        expect(r).toMatchObject({ ok: true, usage: { connection: 'router' } });
        expect(h.records[0].record['attempts']).toMatchObject([{ outcome: 'unavailable' }, { outcome: 'ok' }]);

        live();
        delete h.keys['qwen'];
        answers({ ok: true, text: '{"items":[]}', usage });
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1' })).toMatchObject({ ok: true, usage: { connection: 'router' } });

        live();
        const send = answers({ ok: false, failure: 'blocked', detail: 'the provider blocked the answer' });
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1' })).toMatchObject({ ok: false, reason: 'blocked' });
        expect(send).toHaveBeenCalledTimes(1);
        expect(h.released).toBe(1);
    });

    it('says unavailable when every model is busy or retired, with the last wait', async () => {
        live();
        answers({ ok: false, failure: 'retired', detail: 'gone' }, { ok: false, failure: 'unavailable', detail: '429', wait: 30 });
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1' })).toMatchObject({ ok: false, reason: 'unavailable', wait: 30 });
    });

    it('skips a model that cannot read the input', async () => {
        live({ purposes: { 'menu-scan': { models: [{ connection: 'router', model: 'text-only' }] } } });
        const send = answers();
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1', input: { bytes: JPEG, mimeType: 'image/jpeg' } })).toMatchObject({ ok: false, reason: 'off', detail: 'no model in the list reads pictures' });
        expect(send).not.toHaveBeenCalled();
        // Text alone goes to it.
        answers({ ok: true, text: '{"items":[]}', usage });
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1', input: 'Tea 4.50' })).toMatchObject({ ok: true });
    });

    it('says unreadable when the answer does not fit the schema, without trying another model', async () => {
        live();
        const send = answers({ ok: true, text: '{"items":[{"name":"Tea"}]}', usage });
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1' })).toMatchObject({ ok: false, reason: 'unreadable', detail: 'the answer does not fit the schema: answer.items[0].price is missing' });
        expect(send).toHaveBeenCalledTimes(1);
        // It was answered, so it was paid for.
        expect(h.records[0].record['tokensIn']).toBe(1000);
    });

    it('passes a timeout on', async () => {
        live();
        answers({ ok: false, failure: 'timeout', detail: 'no answer within 60 seconds' }, { ok: false, failure: 'timeout', detail: 'no answer within 58 seconds' });
        expect(await askAi({ purpose: 'menu-scan', limitKey: 'b1' })).toMatchObject({ ok: false, reason: 'timeout' });
    });

    it('keeps the question and answer only when the purpose\'s switch is on', async () => {
        live({ purposes: { summary: { keepContent: true } }, tiers: { fast: [{ connection: 'qwen', model: 'qwen3-vl-plus' }] } });
        answers({ ok: true, text: 'Short.', usage });
        expect(await askAi({ purpose: 'summary', input: 'Long notes' })).toMatchObject({ ok: true, text: 'Short.' });
        expect(h.records[0].content).toMatchObject({ instruction: 'Summarise.', answer: 'Short.' });
    });
});
