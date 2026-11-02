/**
 * askAi for speech (specs/ai-media-spec.md, AM-D4, AM-D16, AM-D17, AM-D18, section 8 item 1):
 * named voices mapped per provider, the admin's choice over the app's, a model skipped when
 * its provider has no voice for the name, a text too long, a format or language it lacks;
 * the voice in the cache key and the record; and Arc's own voice sample purpose. Providers
 * are fake connectors; Firestore and Storage are mocked at their modules.
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
}));

vi.mock('../custom/ai.js', () => ({
    AI_PURPOSES: {
        read: {
            label: 'Read aloud',
            makes: 'speech',
            instruction: 'Calm and warm.',
            voices: { narrator: { elevenlabs: 'EL_NARRATOR', sarvam: 'priya' }, guest: { elevenlabs: 'EL_GUEST' } },
            speech: { language: 'hi-IN' },
            cache: true,
        },
        plain: { label: 'Plain', makes: 'speech' },
        single: { label: 'Single', makes: 'speech', voices: { one: { sarvam: 'priya', elevenlabs: 'EL_ONE' } }, fallback: false },
        opus: { label: 'Opus', makes: 'speech', voices: { one: { sarvam: 'priya', elevenlabs: 'EL_ONE' } }, speech: { format: 'opus' } },
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
    noteConnection: async (_s: unknown, id: string, error: string | null) => void h.noted.push([id, error]),
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

import { askAi, askAiForArc } from '../ai/askAi.js';
import { replaceFileConnectorsForTest } from '../ai/connectors/index.js';
import type { FileConnector, FileRequest, FileResult } from '../ai/connectors/types.js';
import { ARC_PURPOSES, purposeProblems } from '../ai/purposes.js';
import { captureAiAsks } from '../ai/askAi.js';

const said: FileResult = { ok: true, files: [{ bytes: Buffer.from('ID3audio'), mimeType: 'audio/mpeg', seconds: 1.5 }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 } };

function live(lists: Array<{ connection: string; model: string }>, extra: Record<string, unknown> = {}) {
    h.settings = {
        mode: 'live',
        connections: { eleven: { preset: 'elevenlabs' }, sarvam: { preset: 'sarvam' }, google: { preset: 'vertex' } },
        lists: { speech: lists },
        ...extra,
    };
}

/** Fake speech connectors, by file connector, each recording what it was asked. */
function speakers(answers: Partial<Record<'elevenlabs' | 'sarvam' | 'vertex', FileResult>> = {}): FileRequest[] {
    const asked: FileRequest[] = [];
    const make = (k: 'elevenlabs' | 'sarvam' | 'vertex'): FileConnector => async (_c, r) => (asked.push({ ...r, model: `${k}:${r.model}` }), answers[k] ?? said);
    replaceFileConnectorsForTest({ elevenlabs: make('elevenlabs'), sarvam: make('sarvam'), vertex: make('vertex') });
    return asked;
}

const EL = { connection: 'eleven', model: 'eleven_v4' };
const SV = { connection: 'sarvam', model: 'bulbul:v3' };
const GG = { connection: 'google', model: 'tts-chirp3-hd' };

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
    h.noted = [];
});
afterEach(() => replaceFileConnectorsForTest({}));

describe('named voices', () => {
    it('are checked when the functions load', () => {
        expect(purposeProblems({ talk: { label: 'A', makes: 'speech', voices: { narrator: { elevenlabs: 'X1' } } } })).toEqual([]);
        expect(purposeProblems({ talk: { label: 'A', makes: 'image', voices: { n: { elevenlabs: 'X' } } } })[0]).toContain('voices are for a purpose that makes speech');
        expect(purposeProblems({ talk: { label: 'A', makes: 'speech', voices: {} } })[0]).toContain('at least one named voice');
        expect(purposeProblems({ talk: { label: 'A', makes: 'speech', voices: { '1bad': { elevenlabs: 'X' } } } })[0]).toContain('voice name "1bad"');
        expect(purposeProblems({ talk: { label: 'A', makes: 'speech', voices: { n: { openai: 'alloy' } } } })[0]).toContain('makes no speech');
        expect(purposeProblems({ talk: { label: 'A', makes: 'speech', voices: { n: { elevenlabs: '../x' } } } })[0]).toContain('no usable elevenlabs voice id');
    });

    it('Arc\'s own purposes pass the same checks as an app\'s, but for their arc- ids', () => {
        const renamed = Object.fromEntries(Object.entries(ARC_PURPOSES).map(([id, p]) => [id.replace(/^arc-/, 'own-'), p]));
        expect(purposeProblems(renamed)).toEqual([]);
    });

    it('are recorded by an app\'s unit tests that capture its calls', async () => {
        const ai = captureAiAsks();
        try {
            await askAi({ purpose: 'read', input: 'Hi.', voice: 'guest' });
            await askAi({ purpose: 'read', input: 'Hi.' });
            expect(ai.asks.map((a) => a.voice)).toEqual(['guest', 'narrator']);
        } finally {
            ai.stop();
        }
    });

    it('are asked for by name: an unknown one, or one for another kind, is a mistake', async () => {
        await expect(askAi({ purpose: 'read', input: 'Hi', voice: 'host' })).rejects.toThrow('voice must be one of read\'s voices: narrator, guest');
        await expect(askAi({ purpose: 'ask', input: 'Hi', voice: 'narrator' })).rejects.toThrow('voice is for a purpose that makes speech');
        // Arc's own purposes are not the app's to call.
        await expect(askAi({ purpose: 'arc-voice-sample', input: 'Hi' })).rejects.toThrow('no purpose "arc-voice-sample"');
    });

    it('send each provider its own id for the voice, the first voice by default, and keep it on the record', async () => {
        live([EL]);
        const asked = speakers();
        const r = await askAi({ purpose: 'read', input: 'Namaste.' });
        expect(r).toMatchObject({ ok: true, files: [{ mimeType: 'audio/mpeg', seconds: 1.5 }] });
        expect(asked[0]).toMatchObject({ kind: 'speech', voice: 'EL_NARRATOR', speech: { language: 'hi-IN' } });
        // Speech is the text alone: the instruction is never read aloud.
        expect(asked[0].prompt).toBe('Namaste.');
        expect(h.records[0].record).toMatchObject({ kind: 'speech', voice: 'narrator', voiceId: 'EL_NARRATOR', unit: 'characters', amount: 8 });
        await askAi({ purpose: 'read', input: 'Namaste.', voice: 'guest' });
        expect(asked[1].voice).toBe('EL_GUEST');
    });

    it('use the admin\'s voice over the app\'s', async () => {
        live([EL], { purposes: { read: { voices: { narrator: { elevenlabs: 'ADMIN_PICK' } } } } });
        const asked = speakers();
        await askAi({ purpose: 'read', input: 'Hi.' });
        expect(asked[0].voice).toBe('ADMIN_PICK');
    });

    it('skip a model whose provider has no voice for the name, and say how to choose one when none has', async () => {
        live([GG, SV]);
        const asked = speakers();
        const r = await askAi({ purpose: 'read', input: 'Hi.' });
        expect(r.ok).toBe(true);
        expect(asked.map((a) => a.model)).toEqual(['sarvam:bulbul:v3']);
        expect(asked[0].voice).toBe('priya');
        expect((h.records[0].record['attempts'] as Array<Record<string, unknown>>)[0]).toMatchObject({ connection: 'google', outcome: 'skipped' });
        h.records = [];
        live([GG]);
        const none = await askAi({ purpose: 'plain', input: 'Hi.' });
        expect(none).toMatchObject({ ok: false, reason: 'off' });
        expect((none as { detail: string }).detail).toContain('has no voice for "default": choose one in Settings, AI, Purposes');
    });

    it('give a purpose with no voices of its own one named default, for the admin to map', async () => {
        live([SV], { purposes: { plain: { voices: { default: { sarvam: 'kavya' } } } } });
        const asked = speakers();
        await askAi({ purpose: 'plain', input: 'Hi.' });
        expect(asked[0].voice).toBe('kavya');
        expect(h.records[0].record).toMatchObject({ voice: 'default', voiceId: 'kavya' });
    });
});

describe('what a speech model takes', () => {
    it('skips a model the text is too long for, and answers too-large when none takes it', async () => {
        // Sarvam takes 2,500 characters, ElevenLabs v4 10,000.
        live([SV, EL]);
        const asked = speakers();
        const long = 'a'.repeat(3000);
        expect((await askAi({ purpose: 'read', input: long })).ok).toBe(true);
        expect(asked.map((a) => a.model)).toEqual(['elevenlabs:eleven_v4']);
        live([SV]);
        const r = await askAi({ purpose: 'read', input: long });
        expect(r).toMatchObject({ ok: false, reason: 'too-large' });
        expect((r as { detail: string }).detail).toContain('send a paragraph at a time');
    });

    it('says what to fix when one model is too short and another has no voice, not too-large', async () => {
        live([SV, GG]);
        speakers();
        // The text is too long for Sarvam; Google has no voice for narrator at all.
        const r = await askAi({ purpose: 'read', input: 'a'.repeat(3000) });
        expect(r).toMatchObject({ ok: false, reason: 'off' });
        expect((r as { detail: string }).detail).toContain('has no voice for "narrator"');
    });

    it('lets the next speech model try when a provider says the text is too long for it', async () => {
        live([SV, EL]);
        const asked = speakers({ sarvam: { ok: false, failure: 'too-large', detail: 'text exceeds the limit' } });
        expect((await askAi({ purpose: 'read', input: 'Hi.' })).ok).toBe(true);
        expect(asked.map((a) => a.model)).toEqual(['sarvam:bulbul:v3', 'elevenlabs:eleven_v4']);
    });

    it('skips a Google model for a voice of another type before anything is sent, and leaves the card alone', async () => {
        live([GG], { purposes: { plain: { voices: { default: { vertex: 'en-US-Neural2-A' } } } } });
        const asked = speakers();
        const r = await askAi({ purpose: 'plain', input: 'Hi.' });
        expect(r).toMatchObject({ ok: false, reason: 'off' });
        expect((r as { detail: string }).detail).toContain('is not a Chirp3-HD voice');
        expect(asked).toHaveLength(0);
        // A speech failure of a provider that also answers text never marks its card.
        live([GG], { purposes: { plain: { voices: { default: { vertex: 'en-US-Chirp3-HD-Kore' } } } } });
        speakers({ vertex: { ok: false, failure: 'off', detail: 'switch on the Cloud Text-to-Speech API' } });
        await askAi({ purpose: 'plain', input: 'Hi.' });
        speakers();
        await askAi({ purpose: 'plain', input: 'Hi.' });
        expect(h.noted).toEqual([]);
        // A provider that only speaks: its success is its card's.
        live([EL]);
        await askAi({ purpose: 'read', input: 'Hi.' });
        expect(h.noted).toEqual([['eleven', null]]);
    });

    it('counts Google\'s cap in bytes, so Devanagari meets it sooner', async () => {
        live([GG], { purposes: { plain: { voices: { default: { vertex: 'hi-IN-Chirp3-HD-Kore' } } } } });
        speakers();
        // 1,800 Devanagari characters are 5,400 bytes: over Google's 5,000.
        expect(await askAi({ purpose: 'plain', input: 'क'.repeat(1800) })).toMatchObject({ ok: false, reason: 'too-large' });
        expect((await askAi({ purpose: 'plain', input: 'क'.repeat(1500) })).ok).toBe(true);
    });

    it('skips a model that makes no such format, or speaks no such language', async () => {
        live([SV, EL]);
        const asked = speakers();
        // Sarvam makes no Opus; ElevenLabs does.
        await askAi({ purpose: 'opus', input: 'Hi.' });
        expect(asked.at(-1)!.model).toBe('elevenlabs:eleven_v4');
        expect((h.records.at(-1)!.record['attempts'] as Array<Record<string, unknown>>)[0]).toMatchObject({ connection: 'sarvam', outcome: 'skipped', detail: 'makes no opus' });
        await askAi({ purpose: 'read', input: 'Bonjour.', speech: { language: 'fr-FR' } });
        expect(asked.at(-1)!.model).toBe('elevenlabs:eleven_v4');
        // en-US is English: Sarvam speaks it as en-IN.
        await askAi({ purpose: 'read', input: 'Hello.', speech: { language: 'en-US' } });
        expect(asked.at(-1)!.model).toBe('sarvam:bulbul:v3');
    });

    it('with fallback off, only the first model ever answers, even when it is skipped', async () => {
        live([GG, SV]);
        const asked = speakers();
        const r = await askAi({ purpose: 'single', input: 'Hi.' });
        expect(r).toMatchObject({ ok: false, reason: 'off' });
        expect(asked).toHaveLength(0);
    });
});

describe('the cache and Arc\'s voice sample', () => {
    it('keys a cached file by the voice: the same words in another voice are another file', async () => {
        live([EL]);
        speakers();
        await askAi({ purpose: 'read', input: 'Hi.' });
        await askAi({ purpose: 'read', input: 'Hi.', voice: 'guest' });
        const [a, b] = h.cacheStored.map((e) => e['hash']);
        expect(a).toBeTruthy();
        expect(a).not.toBe(b);
    });

    it('makes a sample with the one model and voice id asked for, as Arc\'s own purpose', async () => {
        live([SV]);
        const asked = speakers();
        const r = await askAiForArc({ purpose: 'arc-voice-sample', input: 'Hello, this is a sample of my voice.' }, { only: EL, voiceId: 'SOME_VOICE' });
        expect(r.ok).toBe(true);
        expect(asked).toHaveLength(1);
        expect(asked[0]).toMatchObject({ model: 'elevenlabs:eleven_v4', voice: 'SOME_VOICE' });
        expect(h.records[0].record).toMatchObject({ purpose: 'arc-voice-sample', voiceId: 'SOME_VOICE' });
        // Cached a year, so each voice is paid for once.
        expect(h.cacheStored[0]).toMatchObject({ purpose: 'arc-voice-sample', days: 365 });
    });

    it('answers a silent stand-in in test mode, with nothing sent', async () => {
        h.settings = { mode: 'test', connections: { eleven: { preset: 'elevenlabs' } } };
        const asked = speakers();
        const r = await askAiForArc({ purpose: 'arc-voice-sample', input: 'Hello.' }, { only: EL, voiceId: 'V' });
        expect(r).toMatchObject({ ok: true, files: [{ mimeType: 'audio/wav' }], usage: { test: true, costUsd: 0 } });
        expect(asked).toHaveLength(0);
    });
});
