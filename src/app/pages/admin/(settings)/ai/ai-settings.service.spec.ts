/**
 * Settings, AI's data (docs/app/ai.html): the form from Settings/ai, what saving writes
 * (keeping what only the server writes, deleting what was taken away), the month's usage,
 * a call's record, and the CSV download.
 */
import { describe, expect, it } from 'vitest';
import { deleteField } from '@angular/fire/firestore';
import { aiFormFrom, aiSettingsData, callContentFrom, callRowFrom, callsCsv, connectionId, emptyAiForm, monthUsageFrom, removalData } from './ai-settings.service';

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
        expect(form.purposes['menu-scan']).toEqual({ enabled: false, models: [], perKeyPerDay: 20, keepContent: true });
        expect(form.models['qwen/qwen3-vl-plus']).toEqual({ reads: ['pictures'], priceIn: 0.3 });
        expect(form.monthlyUsd).toBe(50);
    });
});

describe('aiSettingsData', () => {
    const loaded = aiFormFrom({
        connections: { qwen: { preset: 'alibaba-eu', workspace: 'ws1', keyPreview: '••••1234' }, old: { preset: 'openrouter' } },
        models: { 'old/x': { priceIn: 1 } },
    });

    it('never writes what only the server writes, such as the key preview', () => {
        const data = aiSettingsData(loaded, loaded) as { connections: Record<string, Record<string, unknown>> };
        expect(data.connections['qwen']).toEqual({ preset: 'alibaba-eu', label: '', workspace: 'ws1', baseUrl: '', location: '', processesIn: '' });
        expect(JSON.stringify(data)).not.toContain('1234');
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

    it('clears the key of a provider whose workspace changed', () => {
        const form = { ...before, connections: before.connections.map((c) => (c.id === 'qwen' ? { ...c, workspace: 'ws2' } : c)) };
        const data = aiSettingsData(form, before) as { connections: Record<string, Record<string, unknown>> };
        expect(data.connections['qwen']['keyPreview']).toEqual(deleteField());
        expect(data.connections['qwen']['lastOkAt']).toEqual(deleteField());
        expect(data.connections['or']).not.toHaveProperty('keyPreview');
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
    });

    it('makes a CSV a spreadsheet will not run as formulas', () => {
        const csv = callsCsv([row]);
        const [head, line] = csv.trim().split('\n');
        expect(head.split(',')[0]).toBe('time (UTC)');
        expect(line).toContain('2026-10-28T10:00:00.000Z,menu-scan,no,ok,,qwen,qwen3-vl-plus,1000,200,0,0.000520,price-list,1200,b1,2,');
        expect(line).toContain('"\'=HYPERLINK(""x"")"');
    });
});
