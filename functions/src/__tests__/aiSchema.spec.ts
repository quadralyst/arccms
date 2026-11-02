/**
 * The answer's shape (specs/ai-spec.md, AI-D10), the purposes' checks (AI-D2) and the
 * settings' defaults and guards (AI-D7, AI-D8, AI-D19).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../init', () => ({ db: {}, storage: {}, owner: {} }));

import { answerProblems, emptyAnswer, parseJsonAnswer, schemaProblems, strictSchema, withoutAddedNulls, type JsonSchema } from '../ai/schema.js';
import { purposeProblems } from '../ai/purposes.js';
import { connectionBaseUrl, connectionProcessesIn, defaultVertexLocation, modelInfo, resolveAiSettings, safeBaseUrl } from '../ai/settings.js';
import { aiTestFailure } from '../ai/types.js';

const MENU: JsonSchema = {
    type: 'object',
    properties: {
        sections: {
            type: 'array',
            items: {
                type: 'object',
                properties: { name: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: ['number', 'null'] } }, required: ['name', 'price'], additionalProperties: false } } },
                required: ['name', 'items'],
            },
        },
        currency: { enum: ['CHF', 'EUR'] },
    },
    required: ['sections', 'currency'],
};

describe('schemaProblems', () => {
    it('accepts the part of JSON schema models take', () => {
        expect(schemaProblems(MENU)).toEqual([]);
    });

    it('names each mistake', () => {
        expect(schemaProblems({ type: 'thing' })).toEqual(['schema.type "thing" is not one of object, array, string, number, integer, boolean, null']);
        expect(schemaProblems({ type: 'array' })).toContain('schema is an array without items');
        expect(schemaProblems({ type: 'object', required: ['x'], properties: {} })).toContain('schema.required names "x", which is not in properties');
        expect(schemaProblems({ description: 'no type' })).toContain('schema needs a type or an enum');
        expect(schemaProblems([])).toEqual(['schema must be an object']);
    });
});

describe('answerProblems', () => {
    const good = { sections: [{ name: 'Drinks', items: [{ name: 'Tea', price: 4.5 }, { name: 'Water', price: null }] }], currency: 'CHF' };

    it('passes an answer that fits', () => {
        expect(answerProblems(good, MENU)).toEqual([]);
    });

    it('says where an answer differs', () => {
        expect(answerProblems({ ...good, currency: 'USD' }, MENU)).toEqual(['answer.currency should be one of "CHF", "EUR"']);
        expect(answerProblems({ sections: [{ name: 'Drinks', items: [{ name: 'Tea', price: '4.50' }] }], currency: 'CHF' }, MENU)).toEqual(['answer.sections[0].items[0].price should be number or null']);
        expect(answerProblems({ sections: [], currency: 'CHF', extra: 1 }, MENU)).toEqual([]);
        expect(answerProblems({ sections: [{ name: 'A', items: [{ name: 'B', price: 1, size: 'L' }] }], currency: 'EUR' }, MENU)).toEqual(['answer.sections[0].items[0].size is not expected']);
        expect(answerProblems({}, MENU)).toEqual(['answer.sections is missing', 'answer.currency is missing']);
        expect(answerProblems(3.5, { type: 'integer' })).toEqual(['answer should be integer']);
        expect(answerProblems([1], { type: 'array', items: { type: 'number' }, minItems: 2 })).toEqual(['answer should have at least 2 items']);
    });
});

describe('own keys only', () => {
    it('does not take an Object property such as toString for a required or known key', () => {
        const closed: JsonSchema = { type: 'object', properties: { a: { type: 'string' } }, required: ['toString'], additionalProperties: false };
        expect(answerProblems({ a: 'x' }, { ...closed, required: ['a'] })).toEqual([]);
        expect(answerProblems({ a: 'x', constructor: 'y' }, { ...closed, required: ['a'] })).toEqual(['answer.constructor is not expected']);
        expect(answerProblems({ a: 'x' }, { type: 'object', properties: { a: { type: 'string' }, toString: { type: 'string' } as JsonSchema }, required: ['toString'] } as JsonSchema)).toEqual(['answer.toString is missing']);
    });
});

describe('strict mode', () => {
    const schema: JsonSchema = { type: 'object', properties: { name: { type: 'string' }, note: { type: 'string' }, lines: { type: 'array', items: { type: 'object', properties: { qty: { type: 'number' } } } } }, required: ['name'] };

    it('closes every object and makes the optional properties required and nullable', () => {
        expect(strictSchema(schema)).toEqual({
            type: 'object',
            properties: {
                name: { type: 'string' },
                note: { type: ['string', 'null'] },
                lines: { type: ['array', 'null'], items: { type: 'object', properties: { qty: { type: ['number', 'null'] } }, required: ['qty'], additionalProperties: false } },
            },
            required: ['name', 'note', 'lines'],
            additionalProperties: false,
        });
    });

    it('takes the nulls it added out again, so the purpose\'s own schema passes', () => {
        const strict = { name: 'A', note: null, lines: [{ qty: null }, { qty: 2 }] };
        const back = withoutAddedNulls(strict, schema);
        expect(back).toEqual({ name: 'A', lines: [{}, { qty: 2 }] });
        expect(answerProblems(back, schema)).toEqual([]);
    });
});

describe('emptyAnswer', () => {
    it('builds the simplest answer that fits', () => {
        const empty = emptyAnswer(MENU);
        expect(empty).toEqual({ sections: [], currency: 'CHF' });
        expect(answerProblems(empty, MENU)).toEqual([]);
        expect(emptyAnswer({ type: 'array', items: { type: 'string' }, minItems: 2 })).toEqual(['', '']);
        expect(emptyAnswer({ type: ['null', 'boolean'] })).toBe(false);
    });
});

describe('parseJsonAnswer', () => {
    it('reads JSON, fenced JSON and JSON in a sentence', () => {
        expect(parseJsonAnswer('{"a":1}')).toEqual({ a: 1 });
        expect(parseJsonAnswer('Here it is:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
        expect(parseJsonAnswer('The list: [1, 2] as asked.')).toEqual([1, 2]);
        expect(parseJsonAnswer('no json here')).toBeUndefined();
        expect(parseJsonAnswer('{"a":')).toBeUndefined();
    });
});

describe('purposeProblems', () => {
    const base = { label: 'Menu scan', instruction: 'Read the menu.' };

    it('accepts a purpose with its input, schema and test answer', () => {
        expect(purposeProblems({ 'menu-scan': { ...base, input: { pictures: { max: 5, maxMb: 10 } }, output: { schema: MENU }, testAnswer: { sections: [], currency: 'EUR' } } })).toEqual([]);
        expect(purposeProblems({ 'menu-scan': { ...base, output: { schema: MENU }, testAnswer: () => ({}), tier: 'cheap', perKeyPerDay: 20, limitKeyLabel: 'merchant' } })).toEqual([]);
        expect(purposeProblems({ 'menu-scan': { ...base, output: { schema: MENU }, testAnswer: aiTestFailure('blocked') } })).toEqual([]);
    });

    it('names each mistake, by purpose', () => {
        const problems = purposeProblems({
            'Menu Scan': base,
            'arc-mine': base,
            'no-label': { instruction: 'x' },
            limits: { ...base, input: { pictures: { max: 0, maxMb: 50 } }, tier: 'huge', perKeyPerDay: 0, limitKeyLabel: ' ', timeoutSeconds: 1, thinking: 'lots' },
            'bad-test': { ...base, output: { schema: MENU }, testAnswer: { sections: 'none' } },
            'bad-schema': { ...base, output: { schema: { type: 'array' } } },
        });
        expect(problems).toEqual(expect.arrayContaining([
            'purpose "Menu Scan": the id must be lower case letters, digits and -, starting with a letter, 2 to 40 characters',
            'purpose "arc-mine": ids starting with arc- are Arc\'s own',
            'purpose "no-label" needs a label',
            'purpose "limits": tier must be one of cheap, fast, thorough',
            'purpose "limits": perKeyPerDay must be a whole number of 1 or more',
            'purpose "limits": limitKeyLabel must be a word or two, at most 40 characters, such as \'merchant\'',
            'purpose "limits": timeoutSeconds must be a whole number from 5 to 540',
            'purpose "limits": thinking must be \'low\' or \'high\'',
            'purpose "limits": input.pictures.max must be a whole number from 1 to 20',
            'purpose "limits": input.pictures.maxMb must be more than 0 and at most 15',
            'purpose "bad-test": testAnswer.sections should be array',
            'purpose "bad-schema": output.schema is an array without items',
        ]));
    });
});

describe('resolveAiSettings', () => {
    it('starts in test mode with nothing set up and a 20 USD budget', () => {
        const s = resolveAiSettings(undefined);
        expect(s.mode).toBe('test');
        expect(s.connections).toEqual({});
        expect(s.tiers).toEqual({ cheap: [], fast: [], thorough: [] });
        expect(s.budget.monthlyUsd).toBe(20);
    });

    it('keeps what is right and drops what is not', () => {
        const s = resolveAiSettings({
            mode: 'live',
            connections: {
                qwen: { preset: 'alibaba-eu', workspace: 'ws1', keyPreview: '••••abcd' },
                'Bad Id': { preset: 'openai' },
                nothing: { preset: 'made-up' },
            },
            tiers: { fast: [{ connection: 'qwen', model: 'qwen3-vl-plus' }, { connection: 'gone', model: 'x' }], huge: [] },
            purposes: { 'menu-scan': { enabled: false, perKeyPerDay: 0, keepContent: true, models: [{ connection: 'qwen', model: 'qwen3-vl-plus' }] } },
            models: { 'qwen/other': { reads: ['pictures', 'audio'], schema: 'loose', priceIn: -1, priceOut: 2 } },
            budget: { monthlyUsd: 'lots' },
        });
        expect(Object.keys(s.connections)).toEqual(['qwen']);
        expect(s.connections['qwen'].label).toBe('Alibaba Cloud Model Studio, Frankfurt (EU)');
        expect(s.tiers.fast).toEqual([{ connection: 'qwen', model: 'qwen3-vl-plus' }]);
        expect(s.purposes['menu-scan']).toEqual({ enabled: false, models: [{ connection: 'qwen', model: 'qwen3-vl-plus' }], perKeyPerDay: null, keepContent: true });
        expect(s.models['qwen/other']).toEqual({ reads: ['pictures'], schema: undefined, priceIn: undefined, priceOut: 2 });
        expect(s.budget.monthlyUsd).toBe(20);
    });
});

describe('models and addresses', () => {
    const s = resolveAiSettings({
        connections: {
            qwen: { preset: 'alibaba-eu', workspace: 'ws-123' },
            'no-ws': { preset: 'alibaba-eu' },
            mine: { preset: 'other', baseUrl: 'https://llm.example.com/v1/', processesIn: 'Switzerland' },
            g: { preset: 'vertex' },
        },
        models: { 'qwen/qwen3-vl-plus': { priceIn: 0.3 } },
    });

    it('knows the preset models, with the admin\'s word first', () => {
        expect(modelInfo(s, { connection: 'qwen', model: 'qwen3-vl-plus' })).toEqual({ reads: ['pictures'], schema: 'json', priceIn: 0.3, priceOut: 1.6 });
        expect(modelInfo(s, { connection: 'mine', model: 'anything' })).toEqual({ reads: [], schema: 'json', priceIn: undefined, priceOut: undefined });
        expect(modelInfo(s, { connection: 'g', model: 'gemini-3.8-flash' }).schema).toBe('strict');
    });

    it('builds each connection\'s address', () => {
        expect(connectionBaseUrl(s.connections['qwen'])).toBe('https://ws-123.eu-central-1.maas.aliyuncs.com/compatible-mode/v1');
        expect(connectionBaseUrl(s.connections['no-ws'])).toBe('');
        expect(connectionBaseUrl(s.connections['mine'])).toBe('https://llm.example.com/v1');
        expect(connectionBaseUrl(s.connections['g'])).toBe('');
        expect(connectionProcessesIn(s.connections['mine'])).toBe('Switzerland');
        expect(connectionProcessesIn(s.connections['qwen'])).toContain('Frankfurt');
    });

    it('calls only https addresses with a public host name', () => {
        expect(safeBaseUrl('https://api.example.com/v1')).toBe(true);
        for (const bad of ['https://metadata.google.internal./v1', 'https://localhost./v1', 'http://api.example.com/v1', 'https://169.254.169.254/v1', 'https://[::1]/v1', 'https://localhost/v1', 'https://metadata.google.internal/v1', 'https://user:pw@api.example.com', 'https://api.example.com/v1?x=1', 'not a url', 'https://10.0.0.1:8443/v1']) {
            expect(safeBaseUrl(bad), bad).toBe(false);
        }
    });

    it('runs Gemini in the functions region\'s multi-region, never global', () => {
        expect(defaultVertexLocation('europe-west6')).toBe('eu');
        expect(defaultVertexLocation('us-central1')).toBe('us');
        expect(defaultVertexLocation('asia-south1')).toBe('asia-south1');
    });
});
