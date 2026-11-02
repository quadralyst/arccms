/**
 * The admin calls for voices (specs/ai-media-spec.md, AM-D18): aiVoices, a speech
 * connection's list, kept 10 minutes and counted as the connection's test; aiVoiceSample, a
 * one-sentence sample in the voice's language through Arc's own purpose; and what
 * aiSetupInfo tells the page of voices. Providers, Firestore and askAi are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Data = Record<string, unknown>;
const h = vi.hoisted(() => ({
    settings: {} as Data,
    noted: [] as Array<[string, string | null]>,
    asks: [] as Array<{ input: Data; options: Data }>,
    answer: null as Data | null,
}));

vi.mock('../init', () => ({ db: {}, storage: {}, owner: {} }));
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
    return { ...real, readAiSettings: async () => real.resolveAiSettings(h.settings), forgetAiSettings: () => undefined };
});
vi.mock('../ai/keys.js', () => ({ readKey: async () => ({ ok: true, key: 'sk_test_key' }) }));
vi.mock('../ai/usage.js', () => ({ noteConnection: async (_s: unknown, id: string, error: string | null) => void h.noted.push([id, error]) }));
vi.mock('../ai/askAi.js', () => ({
    askAiForArc: async (input: Data, options: Data) => (h.asks.push({ input, options }), h.answer),
}));
vi.mock('../custom/ai.js', () => ({
    AI_PURPOSES: { read: { label: 'Read', makes: 'speech', voices: { narrator: { elevenlabs: 'EL1' }, guest: {} } } },
}));

import { aiSetupInfo } from '../ai/callables/aiSetupInfo.js';
import { aiVoices, forgetVoiceLists } from '../ai/callables/aiVoices.js';
import { aiVoiceSample, sampleSentence } from '../ai/callables/aiVoiceSample.js';
import { replaceVoiceListersForTest } from '../ai/connectors/index.js';
import type { VoiceLister } from '../ai/connectors/types.js';

const admin = (data: Data) => ({ auth: { uid: 'a1', token: { admin: true } }, data }) as never;
const member = (data: Data) => ({ auth: { uid: 'm1', token: {} }, data }) as never;
type Fn = (request: never) => Promise<Data>;
const voices = aiVoices as unknown as Fn;
const sample = aiVoiceSample as unknown as Fn;
const setup = aiSetupInfo as unknown as Fn;

const VOICE = { id: 'EL1', name: 'Zed', languages: ['en-US'], gender: 'male' as const, labels: [], previewUrl: null, models: [] };

beforeEach(() => {
    h.settings = {
        mode: 'live',
        connections: { eleven: { preset: 'elevenlabs', keyPreview: '…1234', keySetAt: '2026-11-02T10:00:00Z' }, or: { preset: 'openrouter' }, sarvam: { preset: 'sarvam' } },
    };
    h.noted = [];
    h.asks = [];
    h.answer = null;
    forgetVoiceLists();
});
afterEach(() => replaceVoiceListersForTest({}));

describe('aiVoices', () => {
    it('is for admins, and only for a saved connection that speaks', async () => {
        await expect(voices(member({ connection: 'eleven' }))).rejects.toThrow('Admin access required');
        await expect(voices(admin({ connection: 'gone' }))).rejects.toThrow('Save the connection first');
        await expect(voices(admin({ connection: 'or' }))).rejects.toThrow('makes no speech');
    });

    it('lists the voices sorted by name, keeps them 10 minutes, and counts as the connection\'s test', async () => {
        const lister = vi.fn<VoiceLister>(async () => ({ ok: true, voices: [VOICE, { ...VOICE, id: 'EL2', name: 'Ann' }] }));
        replaceVoiceListersForTest({ elevenlabs: lister });
        const r = await voices(admin({ connection: 'eleven' }));
        expect((r['voices'] as Array<{ name: string }>).map((v) => v.name)).toEqual(['Ann', 'Zed']);
        expect(lister.mock.calls[0][0]).toMatchObject({ key: 'sk_test_key' });
        expect(h.noted).toEqual([['eleven', null]]);
        await voices(admin({ connection: 'eleven' }));
        expect(lister).toHaveBeenCalledTimes(1);
        // Refresh reads the provider again.
        await voices(admin({ connection: 'eleven', fresh: true }));
        expect(lister).toHaveBeenCalledTimes(2);
    });

    it('notes a refused key on the connection, and Sarvam\'s shipped list as no test at all', async () => {
        replaceVoiceListersForTest({ elevenlabs: async () => ({ ok: false, detail: 'ElevenLabs refused the key (401)', keyRefused: true }) });
        expect(await voices(admin({ connection: 'eleven' }))).toEqual({ ok: false, detail: 'ElevenLabs refused the key (401)' });
        expect(h.noted).toEqual([['eleven', 'ElevenLabs refused the key (401)']]);
        h.noted = [];
        const r = await voices(admin({ connection: 'sarvam' }));
        expect((r['voices'] as unknown[]).length).toBeGreaterThan(37);
        expect(h.noted).toEqual([]);
    });
});

describe('aiVoiceSample', () => {
    it('says one sentence in the voice\'s language, English when Arc has none in it', () => {
        expect(sampleSentence('hi-IN')).toContain('नमूना');
        expect(sampleSentence('ta')).toContain('மாதிரி');
        expect(sampleSentence('xx-YY')).toBe('Hello, this is a sample of my voice.');
        expect(sampleSentence(undefined)).toBe('Hello, this is a sample of my voice.');
    });

    it('needs a speech model of the connection and a voice', async () => {
        await expect(sample(member({}))).rejects.toThrow('Admin access required');
        await expect(sample(admin({ connection: 'eleven', model: 'gpt-4o', voice: 'EL1' }))).rejects.toThrow('Choose a speech model');
        await expect(sample(admin({ connection: 'eleven', model: 'eleven_v4', voice: '../x' }))).rejects.toThrow('Choose a voice');
    });

    it('asks Arc\'s purpose with only that model and voice, and answers the file to play', async () => {
        h.answer = { ok: true, files: [{ path: 'ai-files/arc-voice-sample/2026-11/rec-1.mp3', mimeType: 'audio/mpeg', bytes: 10 }], cached: true, usage: { test: false, costUsd: 0 } };
        const r = await sample(admin({ connection: 'eleven', model: 'eleven_v4', voice: 'EL1', language: 'hi-IN' }));
        expect(h.asks[0]).toEqual({
            input: { purpose: 'arc-voice-sample', input: sampleSentence('hi-IN'), speech: { language: 'hi-IN' } },
            options: { only: { connection: 'eleven', model: 'eleven_v4' }, voiceId: 'EL1' },
        });
        expect(r).toEqual({ ok: true, path: 'ai-files/arc-voice-sample/2026-11/rec-1.mp3', mimeType: 'audio/mpeg', cached: true, test: false, costUsd: 0 });
        h.answer = { ok: false, reason: 'limit', detail: 'the month\'s budget is spent', usage: {} };
        expect(await sample(admin({ connection: 'eleven', model: 'eleven_v4', voice: 'EL1' }))).toEqual({ ok: false, reason: 'limit', detail: 'the month\'s budget is spent' });
    });
});

describe('aiSetupInfo', () => {
    it('shows a speech purpose\'s voices with the app\'s ids, Arc\'s own purpose marked, and which providers speak', async () => {
        const r = await setup(admin({}));
        const purposes = r['purposes'] as Array<Data>;
        expect(purposes.find((p) => p['id'] === 'read')).toMatchObject({ arc: false, voices: [{ name: 'narrator', ids: { elevenlabs: 'EL1' } }, { name: 'guest', ids: {} }] });
        expect(purposes.find((p) => p['id'] === 'arc-voice-sample')).toMatchObject({ arc: true, voices: [] });
        const presets = r['presets'] as Array<Data>;
        expect(presets.find((p) => p['id'] === 'elevenlabs')).toMatchObject({ makesSpeech: true, makesText: false, files: 'elevenlabs' });
        expect(presets.find((p) => p['id'] === 'sarvam')).toMatchObject({ makesSpeech: true, makesText: true, files: 'sarvam' });
        expect(presets.find((p) => p['id'] === 'openrouter')).toMatchObject({ makesSpeech: false, makesText: true, files: null });
    });
});
