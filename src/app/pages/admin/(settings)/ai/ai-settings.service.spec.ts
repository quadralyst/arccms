/**
 * Settings, AI's data (docs/app/ai.html): the form from Settings/ai, what saving writes
 * (keeping what only the server writes, deleting what was taken away), the month's usage,
 * a call's record, and the CSV download.
 */
import { describe, expect, it } from 'vitest';
import { deleteField } from '@angular/fire/firestore';
import {
    addressChanged, aiFormFrom, aiSettingsData, base64Blob, blankConnection, callContentFrom, callRowFrom, callsCsv, connectionId, emptyAiForm, monthUsageFrom,
    naturalUnit, presetNeedsKey, removalData, safeHeaderName,
} from './ai-settings.service';

describe('aiFormFrom', () => {
    it('starts in test mode with nothing set up and a 20 USD budget', () => {
        expect(aiFormFrom(undefined)).toEqual(emptyAiForm());
        expect(emptyAiForm()).toMatchObject({ mode: 'test', monthlyUsd: 20 });
    });

    it('reads connections with the key preview the server wrote, tiers, purposes and models', () => {
        const form = aiFormFrom({
            mode: 'live',
            connections: { qwen: { preset: 'alibaba-eu', label: 'Qwen EU', workspace: 'ws1', keyPreview: '••••1234', keySetBy: 'a@example.com' } },
            tiers: { thorough: [{ connection: 'qwen', model: 'qwen3-vl-plus' }, { model: 'no connection' }] },
            purposes: { 'menu-scan': { enabled: false, perKeyPerDay: 20, keepContent: true } },
            models: { 'qwen/qwen3-vl-plus': { reads: ['pictures', 'audio'], priceIn: 0.3 } },
            budget: { monthlyUsd: 50 },
        });
        expect(form.connections[0]).toMatchObject({ id: 'qwen', label: 'Qwen EU', keyPreview: '••••1234', keySetBy: 'a@example.com' });
        expect(form.tiers.thorough).toEqual([{ connection: 'qwen', model: 'qwen3-vl-plus' }]);
        expect(form.purposes['menu-scan']).toEqual({ enabled: false, models: [], perKeyPerDay: 20, keepContent: true, cache: null, deleteAfterDays: null, voices: {} });
        expect(form.models['qwen/qwen3-vl-plus']).toEqual({ reads: ['pictures'], priceIn: 0.3 });
        expect(form.monthlyUsd).toBe(50);
    });

    it('reads the header, limits, rate and balance of a connection, the file lists and what purposes and models say of files', () => {
        const form = aiFormFrom({
            connections: {
                o: { preset: 'other', header: 'X-Api-Key', perMinute: 60, atOnce: 3.5, usdRate: 0.012, balance: 4.5, balanceUnit: 'USD', balanceAt: '2026-11-02T10:00:00Z', lowBalance: 2 },
                b: { preset: 'other', header: 'Authorization' },
            },
            lists: { image: [{ connection: 'o', model: 'pic-1' }], speech: 'nonsense' },
            purposes: { cover: { cache: false, deleteAfterDays: 30 }, bad: { cache: 'yes', deleteAfterDays: 9999 } },
            models: { 'o/pic-1': { makes: 'image', unit: 'pictures', price: 0.04, priceCachedIn: 0.1, priceCacheWrite: 1 }, 'o/x': { makes: 'smell', unit: 'boxes' } },
        });
        expect(form.connections.find((c) => c.id === 'o')).toMatchObject({ header: 'x-api-key', perMinute: 60, atOnce: null, usdRate: 0.012, balance: 4.5, balanceUnit: 'USD', balanceAt: '2026-11-02T10:00:00Z', lowBalance: 2 });
        expect(form.connections.find((c) => c.id === 'b')?.header).toBe('');
        expect(form.lists).toEqual({ image: [{ connection: 'o', model: 'pic-1' }], speech: [], audio: [], video: [] });
        expect(form.purposes['cover']).toMatchObject({ cache: false, deleteAfterDays: 30 });
        expect(form.purposes['bad']).toMatchObject({ cache: null, deleteAfterDays: null });
        expect(form.models['o/pic-1']).toEqual({ makes: 'image', unit: 'pictures', price: 0.04, priceCachedIn: 0.1, priceCacheWrite: 1 });
        expect(form.models['o/x']).toEqual({});
    });
});

describe('aiSettingsData', () => {
    const loaded = aiFormFrom({
        connections: { qwen: { preset: 'alibaba-eu', workspace: 'ws1', keyPreview: '••••1234' }, old: { preset: 'openrouter' } },
        models: { 'old/x': { priceIn: 1 } },
    });

    it('never writes what only the server writes, such as the key preview', () => {
        const data = aiSettingsData(loaded, loaded) as { connections: Record<string, Record<string, unknown>> };
        expect(data.connections['qwen']).toEqual({
            preset: 'alibaba-eu', label: '', workspace: 'ws1', baseUrl: '', location: '', processesIn: '',
            header: deleteField(), perMinute: deleteField(), atOnce: deleteField(), usdRate: deleteField(), lowBalance: deleteField(),
        });
        expect(JSON.stringify(data)).not.toContain('1234');
    });

    it('round-trips the new fields: header (Other only), limits, rate, low mark, lists, purpose file settings and model prices', () => {
        const stored = {
            connections: {
                o: { preset: 'other', baseUrl: 'https://api.example.com/v1', header: 'api-key', perMinute: 60, atOnce: 3, lowBalance: 5, balance: 9, balanceUnit: 'USD', balanceAt: '2026-11-02T10:00:00Z' },
                s: { preset: 'sarvam', header: 'api-key', usdRate: 0.012 },
            },
            lists: { image: [{ connection: 'o', model: 'pic-1' }], speech: [], audio: [], video: [{ connection: 'o', model: 'vid-1' }] },
            purposes: { cover: { enabled: true, models: [], keepContent: false, cache: false, deleteAfterDays: 30 } },
            models: { 'o/pic-1': { makes: 'image', unit: 'pictures', price: 0.04 }, 's/sarvam-105b': { priceIn: 15, priceOut: 60, priceCachedIn: 5, priceCacheWrite: 7 } },
        };
        const form = aiFormFrom(stored);
        const data = aiSettingsData(form, form) as Record<string, any>;
        expect(data['connections']['o']).toMatchObject({ header: 'api-key', perMinute: 60, atOnce: 3, lowBalance: 5, usdRate: deleteField() });
        // The balance is the functions' to write, and a preset with its own header writes none.
        expect(data['connections']['o']).not.toHaveProperty('balance');
        expect(data['connections']['o']).not.toHaveProperty('balanceAt');
        expect(data['connections']['s']).toMatchObject({ header: deleteField(), usdRate: 0.012 });
        expect(data['lists']).toEqual(stored.lists);
        expect(data['purposes']['cover']).toMatchObject({ cache: false, deleteAfterDays: 30 });
        expect(data['models']['o/pic-1']).toMatchObject({ makes: 'image', unit: 'pictures', price: 0.04, priceIn: deleteField() });
        expect(data['models']['s/sarvam-105b']).toMatchObject({ priceCachedIn: 5, priceCacheWrite: 7, makes: deleteField(), price: deleteField() });
        // What save wrote reads back as the same form.
        expect(aiFormFrom({ ...stored, lists: data['lists'] })).toEqual(form);
    });

    it('reads and writes the admin\'s voices, deleting a voice or provider taken away (AM-D17)', () => {
        const loaded = aiFormFrom({ purposes: { read: { voices: { narrator: { elevenlabs: 'EL1', sarvam: 'priya' }, guest: { sarvam: 'kavya' }, '1bad': { sarvam: 'x' }, odd: { openai: 'alloy', vertex: '../x' } } } } });
        expect(loaded.purposes['read'].voices).toEqual({ narrator: { elevenlabs: 'EL1', sarvam: 'priya' }, guest: { sarvam: 'kavya' } });
        const form = structuredClone(loaded);
        form.purposes['read'].voices = { narrator: { elevenlabs: 'EL2' } };
        const data = aiSettingsData(form, loaded) as Record<string, any>;
        expect(data['purposes']['read']['voices']).toEqual({ narrator: { elevenlabs: 'EL2', sarvam: deleteField() }, guest: deleteField() });
    });

    it('writes a cache switched back on and an emptied days field as the purpose\'s own', () => {
        const form = { ...emptyAiForm(), purposes: { cover: { enabled: true, models: [], perKeyPerDay: null, keepContent: false, cache: null, deleteAfterDays: null, voices: {} } } };
        const data = aiSettingsData(form, emptyAiForm()) as Record<string, any>;
        expect(data['purposes']['cover']).toMatchObject({ cache: deleteField(), deleteAfterDays: deleteField() });
    });

    it('clears what the server noted about an older connection of the same id', () => {
        const added = { ...loaded, connections: [...loaded.connections, { ...loaded.connections[0], id: 'fresh', keyPreview: null }] };
        const data = aiSettingsData(added, loaded) as { connections: Record<string, Record<string, unknown>> };
        expect(data.connections['fresh']['lastError']).toEqual(deleteField());
        expect(data.connections['fresh']['keyPreview']).toEqual(deleteField());
        expect(data.connections['qwen']).not.toHaveProperty('lastError');
    });

    it('deletes a connection and model taken away, and an allowance cleared', () => {
        const form = { ...loaded, connections: loaded.connections.filter((c) => c.id !== 'old'), models: {}, purposes: { 'menu-scan': { enabled: true, models: [], perKeyPerDay: null, keepContent: false } } };
        const data = aiSettingsData(form, loaded) as { connections: Record<string, unknown>; models: Record<string, unknown>; purposes: Record<string, Record<string, unknown>> };
        expect(data.connections['old']).toEqual(deleteField());
        expect(data.models['old/x']).toEqual(deleteField());
        expect(data.purposes['menu-scan']['perKeyPerDay']).toEqual(deleteField());
    });
});

describe('saving parts', () => {
    const before = aiFormFrom({
        connections: { qwen: { preset: 'alibaba-eu', workspace: 'ws1', keyPreview: '••••1234', lastOkAt: '2026-10-28T09:00:00Z' }, or: { preset: 'openrouter' } },
        tiers: { fast: [{ connection: 'or', model: 'x' }, { connection: 'qwen', model: 'qwen3-vl-plus' }] },
        purposes: { a: { models: [{ connection: 'or', model: 'x' }] }, b: { models: [] } },
        models: { 'or/x': { priceIn: 1 }, 'qwen/qwen3-vl-plus': { priceIn: 2 } },
    });

    it('removes a provider and writes nothing else', () => {
        const after = { tiers: { cheap: [], fast: [{ connection: 'qwen', model: 'qwen3-vl-plus' }], thorough: [] }, purposes: { a: { ...before.purposes['a'], models: [] }, b: before.purposes['b'] } };
        const data = removalData('or', after, before) as Record<string, any>;
        expect(Object.keys(data).sort()).toEqual(['connections', 'models', 'purposes', 'tiers']);
        expect(data['connections']['or']).toEqual(deleteField());
        expect(Object.keys(data['purposes'])).toEqual(['a']);
        expect(Object.keys(data['models'])).toEqual(['or/x']);
        expect(data).not.toHaveProperty('mode');
    });

    it('clears the key of an Other provider whose key header changed, as for a new address', () => {
        const other = aiFormFrom({ connections: { o: { preset: 'other', baseUrl: 'https://api.example.com/v1', keyPreview: '••••1234', lastOkAt: '2026-10-28T09:00:00Z' } } });
        const same = { ...other, connections: other.connections.map((c) => ({ ...c, header: 'authorization' })) };
        expect((aiSettingsData(same, other) as any).connections['o']).not.toHaveProperty('keyPreview');
        const form = { ...other, connections: other.connections.map((c) => ({ ...c, header: 'x-api-key' })) };
        const data = aiSettingsData(form, other) as { connections: Record<string, Record<string, unknown>> };
        expect(data.connections['o']['keyPreview']).toEqual(deleteField());
        expect(data.connections['o']['lastOkAt']).toEqual(deleteField());
        expect(data.connections['o']['header']).toBe('x-api-key');
        expect(addressChanged(other.connections[0], form.connections[0])).toBe(true);
    });

    it('takes a removed provider\'s models out of the file lists too', () => {
        const withLists = { ...before, lists: { image: [{ connection: 'or', model: 'pic' }, { connection: 'qwen', model: 'p2' }], speech: [], audio: [], video: [] } };
        const after = { tiers: before.tiers, purposes: before.purposes, lists: { ...withLists.lists, image: [{ connection: 'qwen', model: 'p2' }] } };
        expect((removalData('or', after, withLists) as any).lists.image).toEqual([{ connection: 'qwen', model: 'p2' }]);
        expect(removalData('or', { ...after, lists: withLists.lists }, withLists)).not.toHaveProperty('lists');
    });

    it('clears the key of a provider whose workspace changed', () => {
        const form = { ...before, connections: before.connections.map((c) => (c.id === 'qwen' ? { ...c, workspace: 'ws2' } : c)) };
        const data = aiSettingsData(form, before) as { connections: Record<string, Record<string, unknown>> };
        expect(data.connections['qwen']['keyPreview']).toEqual(deleteField());
        expect(data.connections['qwen']['lastOkAt']).toEqual(deleteField());
        expect(data.connections['or']).not.toHaveProperty('keyPreview');
    });
});

describe('key headers and kinds', () => {
    it('takes a header of lower-case letters, digits and -, never one that changes the request', () => {
        expect(safeHeaderName('x-api-key')).toBe(true);
        expect(safeHeaderName('api-subscription-key')).toBe(true);
        expect(safeHeaderName('X-Api-Key')).toBe(false);
        expect(safeHeaderName('my key')).toBe(false);
        expect(safeHeaderName('host')).toBe(false);
        expect(safeHeaderName('content-type')).toBe(false);
        expect(safeHeaderName('x-forwarded-for')).toBe(false);
    });

    it('needs a key for every provider but Vertex, and bills each kind by its usual unit', () => {
        expect(presetNeedsKey({ kind: 'anthropic' })).toBe(true);
        expect(presetNeedsKey({ kind: 'vertex' })).toBe(false);
        expect(presetNeedsKey({ kind: 'openai', needsKey: false })).toBe(false);
        expect(['text', 'image', 'speech', 'audio', 'video'].map((k) => naturalUnit(k as never))).toEqual(['tokens', 'pictures', 'characters', 'seconds', 'seconds']);
    });

    it('starts a connection with nothing set', () => {
        expect(blankConnection({ id: 'a', preset: 'other', label: 'A' })).toMatchObject({ header: '', perMinute: null, usdRate: null, balance: null, keyPreview: null });
    });
});

describe('connectionId', () => {
    it('is made from the label and never taken twice', () => {
        expect(connectionId('Alibaba Cloud Model Studio, Frankfurt (EU)', [])).toBe('alibaba-cloud-model-studio-fra');
        expect(connectionId('OpenRouter', ['openrouter'])).toBe('openrouter-2');
        expect(connectionId('!!!', [])).toBe('connection');
    });
});

describe('monthUsageFrom', () => {
    it('sorts purposes and models by cost, days by date', () => {
        const u = monthUsageFrom('2026-10', {
            calls: 3, failed: 1, costUsd: 0.6, testCalls: 4,
            byPurpose: { a: { calls: 1, costUsd: 0.1 }, b: { calls: 2, costUsd: 0.5 } },
            byModel: { q: { connection: 'qwen', model: 'qwen3-vl-plus', calls: 3, costUsd: 0.6 } },
            byDay: { '28': { calls: 2 }, '03': { calls: 1 } },
        }, [{ purpose: 'b', limitKey: 'biz1', units: 4, calls: 2, costUsd: 0.5 }]);
        expect(u).toMatchObject({ calls: 3, failed: 1, costUsd: 0.6, testCalls: 4 });
        expect(u.byPurpose.map((p) => p.id)).toEqual(['b', 'a']);
        expect(u.byModel[0]).toMatchObject({ connection: 'qwen', model: 'qwen3-vl-plus' });
        expect(u.byDay.map((d) => d.day)).toEqual(['03', '28']);
        expect(u.keys[0]).toMatchObject({ limitKey: 'biz1', units: 4, costUsd: 0.5 });
    });

    it('reads totals by kind, cache hits apart from calls, cached tokens and amounts in each unit', () => {
        const u = monthUsageFrom('2026-11', {
            calls: 4, cacheHits: 3, tokensIn: 100, tokensCached: 40, pictures: 2, characters: 1200,
            byKind: { text: { calls: 2, costUsd: 0.01, tokensCached: 40 }, image: { calls: 2, costUsd: 0.08, pictures: 2, cacheHits: 3 } },
        }, []);
        expect(u).toMatchObject({ calls: 4, cacheHits: 3, tokensCached: 40, pictures: 2, characters: 1200, seconds: 0 });
        expect(u.byKind.map((k) => k.kind)).toEqual(['image', 'text']);
        expect(u.byKind[0]).toMatchObject({ calls: 2, cacheHits: 3, pictures: 2 });
        expect(monthUsageFrom('2026-11', undefined, []).byKind).toEqual([]);
    });
});

describe('calls', () => {
    const row = callRowFrom('c1', {
        createdAt: { toDate: () => new Date('2026-10-28T10:00:00Z') },
        purpose: 'menu-scan', outcome: 'ok', connection: 'qwen', model: 'qwen3-vl-plus', tokensIn: 1000, tokensOut: 200, costUsd: 0.00052,
        costFrom: 'price-list', ms: 1200, ref: '=HYPERLINK("x")', limitKey: 'b1', units: 2, input: { chars: 10, files: 1, bytes: 2048 },
        attempts: [{ connection: 'qwen', model: 'qwen3-vl-plus', outcome: 'ok', ms: 1200 }],
        hasContent: true,
    });

    it('reads a record, and its kept content apart', () => {
        expect(row).toMatchObject({ id: 'c1', purpose: 'menu-scan', units: 2, input: { files: 1 }, hasContent: true });
        expect(callRowFrom('c2', { purpose: 'x' }).hasContent).toBe(false);
        const content = callContentFrom({ instruction: 'Read.', parts: [{ kind: 'picture', mimeType: 'image/jpeg', size: 3, path: 'ai-calls/c1/1-a.jpeg' }], answer: '{}' });
        expect(content).toMatchObject({ instruction: 'Read.', answer: '{}', parts: [{ kind: 'picture', path: 'ai-calls/c1/1-a.jpeg' }] });
        expect(callContentFrom(undefined)).toBeNull();
        expect(row).toMatchObject({ kind: 'text', unit: 'tokens', files: [], cached: false, cachedFrom: null });
    });

    it('reads a file call: its kind, amount, files and whether it came from the cache', () => {
        const r = callRowFrom('c3', {
            purpose: 'cover', kind: 'image', amount: 2, unit: 'pictures', tokensCached: 5, cached: true, cachedFrom: 'c0',
            files: [{ path: 'ai-files/cover/2026-11/a-1.png', mimeType: 'image/png', bytes: 2048, width: 1024, height: 768 }, { mimeType: 'x' }],
        });
        expect(r).toMatchObject({ kind: 'image', amount: 2, unit: 'pictures', tokensCached: 5, cached: true, cachedFrom: 'c0' });
        expect(r.files).toEqual([{ path: 'ai-files/cover/2026-11/a-1.png', mimeType: 'image/png', bytes: 2048, width: 1024, height: 768 }]);
        expect(callsCsv([r]).trim().split('\n')[1]).toMatch(/,image,2,pictures,yes,5$/);
    });

    it('makes a CSV a spreadsheet will not run as formulas', () => {
        const csv = callsCsv([row]);
        const [head, line] = csv.trim().split('\n');
        expect(head.split(',')[0]).toBe('time (UTC)');
        expect(line).toContain('2026-10-28T10:00:00.000Z,menu-scan,no,ok,,qwen,qwen3-vl-plus,1000,200,0,0.000520,price-list,1200,b1,2,');
        expect(line).toContain('"\'=HYPERLINK(""x"")"');
        expect(head).toContain(',kind,amount,unit,cached,cached tokens');
    });
});

describe('base64Blob', () => {
    it('turns readAiFile\'s base64 into a Blob of its type', async () => {
        const blob = base64Blob(btoa('hello'), 'audio/mpeg');
        expect(blob.type).toBe('audio/mpeg');
        expect(blob.size).toBe(5);
        expect(base64Blob('', '').type).toBe('application/octet-stream');
    });
});
