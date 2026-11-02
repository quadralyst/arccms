/**
 * Other audio (specs/ai-media-spec.md, AM5, section 6.5): ElevenLabs sound effects and music
 * against a fake server that answers as its docs say, success and every failure; how a call is
 * fitted to each model (sound or music, a loop, the length); music refused when the purpose's
 * time cannot cover it; and its price by the second. None has been called for real (AM-D34).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', () => ({ db: {}, storage: {}, owner: {} }));

import { audioSkip, fittedAudio } from '../ai/audios.js';
import { elevenLabsAudio, elevenLabsAudioBody, elevenLabsAudioFormat, elevenLabsProvider } from '../ai/connectors/elevenlabs.js';
import type { FileRequest } from '../ai/connectors/types.js';
import { estimateFor } from '../ai/estimate.js';
import { AI_PRESETS } from '../ai/presets.js';
import { resolveAiSettings } from '../ai/settings.js';
import { silentWav } from '../ai/standins.js';

const c = resolveAiSettings({ connections: { el: { preset: 'elevenlabs' } } }).connections;
const SOUND = AI_PRESETS['elevenlabs'].models['eleven_text_to_sound_v3'];
const MUSIC = AI_PRESETS['elevenlabs'].models['music_v2_5'];

function req(model: string, extra: Partial<FileRequest> = {}): FileRequest {
    return { kind: 'audio', model, prompt: 'Rain on a tin roof', parts: [], audio: { seconds: 8 }, timeoutMs: 5000, ...extra };
}

type Call = { url: string; init: RequestInit };
function fakeFetch(...answers: Array<{ status?: number; json?: unknown; bytes?: Buffer }>): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const a = answers.shift() ?? { status: 500, json: {} };
        const body = a.bytes ?? Buffer.from(JSON.stringify(a.json ?? {}));
        return { status: a.status ?? 200, headers: new Headers({ 'content-type': a.bytes ? 'audio/mpeg' : 'application/json' }), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) } as unknown as Response;
    }));
    return calls;
}
const sent = (call: Call) => JSON.parse(String(call.init.body));

afterEach(() => vi.unstubAllGlobals());

describe('the audio models', () => {
    it('are ElevenLabs\' sound effects and music, billed by the second, not tested live', () => {
        expect(SOUND).toMatchObject({ makes: 'audio', unit: 'seconds', price: 0.002, audio: { type: 'sound', seconds: { min: 0.5, max: 30 }, loop: true }, recommend: ['default'] });
        expect(MUSIC).toMatchObject({ makes: 'audio', unit: 'seconds', price: 0.0025, audio: { type: 'music', seconds: { min: 3, max: 300 }, instrumental: true, formats: ['mp3'] } });
        expect(AI_PRESETS['elevenlabs'].testedLive).toBe(false);
    });
});

describe('fitting a sound or music to a model', () => {
    it('keeps the length in range, a loop and instrumental only where taken, and the format it makes', () => {
        expect(fittedAudio({ seconds: 90, loop: true, format: 'wav', instrumental: true }, SOUND.audio)).toEqual({ type: 'sound', seconds: 30, format: 'wav', loop: true });
        expect(fittedAudio({ seconds: 1, loop: true, format: 'wav', instrumental: true }, MUSIC.audio)).toEqual({ type: 'music', seconds: 3, format: 'mp3', instrumental: true });
        expect(fittedAudio({}, undefined)).toEqual({ seconds: 10 });
    });

    it('skips music for a sound purpose and the other way round, a loop music cannot make, and music longer than the time allows', () => {
        expect(audioSkip({ type: 'sound' }, MUSIC.audio, 60)).toBe('makes music, not sound effects');
        expect(audioSkip({ type: 'music' }, SOUND.audio, 60)).toBe('makes sound effects, not music');
        expect(audioSkip({ loop: true }, MUSIC.audio, 540)).toBe('makes no loops');
        expect(audioSkip({ type: 'music', seconds: 120 }, MUSIC.audio, 60)).toContain('timeoutSeconds (60) cannot cover 120 seconds of music: set it to at least 150');
        expect(audioSkip({ type: 'music', seconds: 120 }, MUSIC.audio, 200)).toBeNull();
        expect(audioSkip({ seconds: 25 }, SOUND.audio, 10)).toBeNull();
    });

    it('estimates a purpose on a model of its own type, not the first in the list', async () => {
        const { purposeModels } = await import('../ai/estimate.js');
        const settings = resolveAiSettings({ connections: { el: { preset: 'elevenlabs' } }, lists: { audio: [{ connection: 'el', model: 'music_v2_5' }, { connection: 'el', model: 'eleven_text_to_sound_v3' }] } });
        expect(purposeModels(settings, 'x', { label: 'X', makes: 'audio' }).map((m) => m.model)).toEqual(['eleven_text_to_sound_v3']);
        expect(purposeModels(settings, 'x', { label: 'X', makes: 'audio', audio: { type: 'music', seconds: 30 }, timeoutSeconds: 120 }).map((m) => m.model)).toEqual(['music_v2_5']);
    });

    it('prices a piece by its seconds, as fitted', () => {
        const info = { makes: 'audio' as const, unit: 'seconds' as const, reads: [], schema: 'json' as const, currency: 'USD' as const, usdRate: 1, testedLive: false, price: 0.002, audio: SOUND.audio };
        expect(estimateFor(info, 'audio', { audio: { seconds: 60 } }, 0)).toMatchObject({ amount: 30, unit: 'seconds', usd: 0.06 });
    });
});

describe('ElevenLabs sound effects and music', () => {
    it('asks for a sound effect with its length, loop and model, and answers the audio with its seconds', async () => {
        expect(elevenLabsAudioFormat(false, 'wav')).toBe('wav_48000');
        expect(elevenLabsAudioFormat(false, 'wav', true)).toBe('mp3_44100_128');
        expect(elevenLabsAudioFormat(true, 'wav')).toBe('mp3_44100_128');
        expect(elevenLabsAudioBody('eleven_text_to_sound_v3', 'Rain', { seconds: 50, loop: true }, { prompt_influence: 2 })).toEqual({ text: 'Rain', model_id: 'eleven_text_to_sound_v3', duration_seconds: 30, loop: true, prompt_influence: 1 });
        const wav = silentWav(2);
        const calls = fakeFetch({ bytes: wav });
        const r = await elevenLabsAudio({ connection: c['el'], key: 'sk_test' }, req('eleven_text_to_sound_v3', { audio: { seconds: 2, format: 'wav' } }));
        expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/sound-generation?output_format=wav_48000');
        expect((calls[0].init.headers as Record<string, string>)['xi-api-key']).toBe('sk_test');
        expect(r).toMatchObject({ ok: true, files: [{ mimeType: 'audio/wav', seconds: 2 }], usage: { amount: 2 } });
    });

    it('asks for music with its length in milliseconds and no vocals when asked, through the same make as speech', async () => {
        expect(elevenLabsAudioBody('music_v2_5', 'A calm piano piece', { seconds: 400, instrumental: true })).toEqual({ prompt: 'A calm piano piece', model_id: 'music_v2_5', music_length_ms: 300_000, force_instrumental: true });
        const calls = fakeFetch({ bytes: Buffer.from('ID3music') });
        const r = await elevenLabsProvider.make({ connection: c['el'], key: 'k' }, req('music_v2_5', { audio: { seconds: 30 } }));
        expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128');
        expect(sent(calls[0])).toMatchObject({ prompt: 'Rain on a tin roof', model_id: 'music_v2_5', music_length_ms: 30_000 });
        // The file's own length cannot be read here, so the length asked is counted.
        expect(r).toMatchObject({ ok: true, files: [{ mimeType: 'audio/mpeg', seconds: 30 }] });
    });

    it('passes on the prompt ElevenLabs suggests for refused music, and reads a plan without music', async () => {
        fakeFetch({ status: 400, json: { detail: { code: 'bad_prompt', message: 'Names an artist', data: { prompt_suggestion: 'An upbeat pop song with bright synths' } } } });
        expect(await elevenLabsAudio({ connection: c['el'], key: 'k' }, req('music_v2_5'))).toMatchObject({ ok: false, failure: 'blocked', detail: expect.stringContaining('it suggests: An upbeat pop song with bright synths') });
        fakeFetch({ status: 400, json: { detail: { status: 'bad_prompt', message: 'harmful' } } });
        expect(await elevenLabsAudio({ connection: c['el'], key: 'k' }, req('music_v2_5'))).toMatchObject({ ok: false, failure: 'blocked' });
        fakeFetch({ status: 403, json: { detail: { code: 'subscription_required', message: 'Music needs a paid plan' } } });
        expect(await elevenLabsAudio({ connection: c['el'], key: 'k' }, req('music_v2_5'))).toMatchObject({ ok: false, failure: 'off', detail: expect.stringContaining('plan does not include') });
        fakeFetch({ status: 402, json: { detail: { code: 'insufficient_credits', message: 'No credits' } } });
        expect(await elevenLabsAudio({ connection: c['el'], key: 'k' }, req('eleven_text_to_sound_v3'))).toMatchObject({ ok: false, failure: 'off', outOfCredit: true });
        fakeFetch({ status: 401, json: { detail: { code: 'invalid_api_key', message: 'bad' } } });
        expect(await elevenLabsAudio({ connection: c['el'], key: 'k' }, req('eleven_text_to_sound_v3'))).toMatchObject({ ok: false, failure: 'key-refused' });
    });
});
