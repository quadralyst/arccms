/**
 * The speech connectors of AM2 (specs/ai-media-spec.md, AM-D7, AM-D18, AM-D32, section 6.2):
 * ElevenLabs, Sarvam, MiniMax and Google Cloud Text-to-Speech, each against a fake server
 * that answers as the provider's docs say, success and every failure; their voice lists; the
 * ElevenLabs balance; and how Arc reads an audio file's length. None has been called for
 * real (AM-D34).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', () => ({ db: {}, storage: {}, owner: {} }));
vi.mock('../ai/connectors/vertex.js', () => ({ googleAccessToken: async () => 'ya29.token' }));

import { mp3Seconds, wavSeconds } from '../ai/audio.js';
import { readElevenLabsSubscription } from '../ai/balances.js';
import { elevenLabsBody, elevenLabsFormat, elevenLabsSpeech, elevenLabsVoice, elevenLabsVoices } from '../ai/connectors/elevenlabs.js';
import { googleTtsBody, googleTtsHost, googleTtsSpeech, googleTtsVoices } from '../ai/connectors/googleTts.js';
import { miniMaxSpeech, miniMaxVoices, readMiniMaxStatus } from '../ai/connectors/minimax.js';
import { sarvamLanguage, sarvamSpeech, sarvamVoices, speakerLanguages } from '../ai/connectors/sarvam.js';
import type { FileRequest } from '../ai/connectors/types.js';
import { AI_PRESETS } from '../ai/presets.js';
import { resolveAiSettings } from '../ai/settings.js';
import { silentWav } from '../ai/standins.js';

const settings = resolveAiSettings({
    connections: {
        eleven: { preset: 'elevenlabs' },
        sarvam: { preset: 'sarvam' },
        mm: { preset: 'minimax' },
        google: { preset: 'vertex', location: 'europe-west4' },
        googleus: { preset: 'vertex', location: 'us' },
    },
});
const c = settings.connections;

function speech(model: string, voice: string, extra: Partial<FileRequest> = {}): FileRequest {
    return { kind: 'speech', model, prompt: 'Hello there.', parts: [], voice, speech: { language: 'hi-IN' }, timeoutMs: 5000, ...extra };
}

type Call = { url: string; init: RequestInit };
/** A fake fetch: each answer in turn, recording what was sent. */
function fakeFetch(...answers: Array<{ status?: number; json?: unknown; bytes?: Buffer; headers?: Record<string, string> }>): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const a = answers.shift() ?? { status: 500, json: { error: 'no more answers' } };
        const body = a.bytes ?? Buffer.from(JSON.stringify(a.json ?? {}));
        const headers = new Headers({ 'content-type': a.bytes ? 'audio/mpeg' : 'application/json', ...(a.headers ?? {}) });
        return { status: a.status ?? 200, headers, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) } as unknown as Response;
    }));
    return calls;
}

const sent = (call: Call) => JSON.parse(String(call.init.body));
const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];

/** One MPEG-1 layer III frame header at 128 kbps, 44.1 kHz, then padding: 16,000 bytes is a second. */
function mp3(bytes: number): Buffer {
    const b = Buffer.alloc(bytes);
    b[0] = 0xff; b[1] = 0xfb; b[2] = 0x90; b[3] = 0x00;
    return b;
}

afterEach(() => vi.unstubAllGlobals());

describe('the speech presets', () => {
    it('make speech, bill by characters, carry their caps and are marked not tested live', () => {
        for (const id of ['elevenlabs', 'minimax']) expect(AI_PRESETS[id]).toMatchObject({ testedLive: false, docsReadOn: '2026-11-02', files: id });
        expect(AI_PRESETS['sarvam'].files).toBe('sarvam');
        expect(AI_PRESETS['vertex'].files).toBe('vertex');
        const speechModels = Object.values(AI_PRESETS).flatMap((p) => Object.values(p.models)).filter((m) => m.makes === 'speech');
        expect(speechModels.length).toBeGreaterThanOrEqual(12);
        for (const m of speechModels) {
            expect(m.unit).toBe('characters');
            expect(m.price).toBeGreaterThan(0);
            expect(m.speech?.maxChars ?? m.speech?.maxBytes).toBeGreaterThan(0);
        }
        // Vertex is tested for text; its speech models are not (AM-D34).
        expect(AI_PRESETS['vertex'].testedLive).toBeUndefined();
        expect(AI_PRESETS['vertex'].models['tts-chirp3-hd'].testedLive).toBe(false);
        expect(AI_PRESETS['elevenlabs']).toMatchObject({ atOnce: 3, balance: 'elevenlabs', auth: { header: 'xi-api-key', prefix: '' } });
        expect(AI_PRESETS['sarvam'].models['bulbul:v4-flash'].speech?.languages).not.toContain('ml-IN');
    });
});

describe('ElevenLabs', () => {
    it('sends the text to the voice with the key in xi-api-key, and counts the characters it says it billed', async () => {
        const calls = fakeFetch({ bytes: mp3(32_000), headers: { 'character-cost': '12', 'request-id': 'r-1' } });
        const r = await elevenLabsSpeech({ connection: c['eleven'], key: 'sk_test' }, speech('eleven_flash_v2_5', 'VOICE1', { speech: { language: 'hi-IN', speed: 1.5 } }));
        expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/text-to-speech/VOICE1?output_format=mp3_44100_128');
        expect(header(calls[0], 'xi-api-key')).toBe('sk_test');
        expect(sent(calls[0])).toEqual({ text: 'Hello there.', model_id: 'eleven_flash_v2_5', language_code: 'hi', voice_settings: { speed: 1.2 } });
        expect(calls[0].init.redirect).toBe('error');
        expect(r).toMatchObject({ ok: true, usage: { amount: 12 }, requestId: 'r-1', files: [{ mimeType: 'audio/mpeg', seconds: 2 }] });
    });

    it('leaves out what a model refuses: a language on Multilingual v2, a speed on v3 and v4', () => {
        expect(elevenLabsBody('eleven_multilingual_v2', 'Hi', { language: 'hi-IN', speed: 0.5 })).toEqual({ text: 'Hi', model_id: 'eleven_multilingual_v2', voice_settings: { speed: 0.7 } });
        expect(elevenLabsBody('eleven_v4', 'Hi', { language: 'en-US', speed: 1.1 })).toEqual({ text: 'Hi', model_id: 'eleven_v4', language_code: 'en' });
        expect(elevenLabsFormat('wav')).toBe('wav_24000');
        expect(elevenLabsFormat('opus')).toBe('opus_48000_128');
    });

    it('reads each failure in Arc\'s words, from detail.status or a validation list', async () => {
        const cases: Array<[number, unknown, Record<string, unknown>]> = [
            [401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } }, { failure: 'key-refused' }],
            [401, { detail: { status: 'quota_exceeded', message: 'insufficient quota' } }, { failure: 'off', outOfCredit: true }],
            [429, { detail: { status: 'too_many_concurrent_requests', message: 'busy' } }, { failure: 'unavailable', rateLimited: true }],
            [400, { detail: { status: 'max_character_limit_exceeded', message: 'too many characters' } }, { failure: 'too-large' }],
            [404, { detail: { status: 'voice_not_found', message: 'A voice with that id was not found' } }, { failure: 'off' }],
            [422, { detail: [{ loc: ['body', 'text'], msg: 'field required', type: 'missing' }] }, { failure: 'unreadable' }],
            [503, { detail: { status: 'system_busy', message: 'down' } }, { failure: 'unavailable' }],
        ];
        for (const [status, json, want] of cases) {
            fakeFetch({ status, json });
            expect(await elevenLabsSpeech({ connection: c['eleven'], key: 'sk_test' }, speech('eleven_v4', 'V'))).toMatchObject({ ok: false, ...want });
        }
        // A key that looks like one is never repeated back.
        fakeFetch({ status: 401, json: { detail: { status: 'invalid_api_key', message: 'Key sk_abcdefghijklmnopqrstuvwxyz is not valid' } } });
        const r = await elevenLabsSpeech({ connection: c['eleven'], key: 'sk_test' }, speech('eleven_v4', 'V'));
        expect(JSON.stringify(r)).not.toContain('abcdefghijklmnop');
    });

    it('needs a key and a voice before anything is sent, and makes speech only', async () => {
        const calls = fakeFetch();
        expect(await elevenLabsSpeech({ connection: c['eleven'], key: null }, speech('eleven_v4', 'V'))).toMatchObject({ ok: false, failure: 'off' });
        expect(await elevenLabsSpeech({ connection: c['eleven'], key: 'k' }, speech('eleven_v4', ''))).toMatchObject({ ok: false, failure: 'off' });
        expect(await elevenLabsSpeech({ connection: c['eleven'], key: 'k' }, { ...speech('eleven_v4', 'V'), kind: 'audio' })).toMatchObject({ ok: false, failure: 'off' });
        expect(calls).toHaveLength(0);
    });

    it('lists voices page by page, with their samples, languages and labels', async () => {
        const calls = fakeFetch(
            { json: { voices: [{ voice_id: 'a', name: 'Aria', labels: { gender: 'female', accent: 'american', use_case: 'narration' }, preview_url: 'https://storage.example.com/a.mp3', verified_languages: [{ language: 'en', locale: 'en-US' }, { language: 'hi', locale: 'hi-IN' }] }], has_more: true, next_page_token: 'p2' } },
            { json: { voices: [{ voice_id: 'b', name: 'Bo', labels: {}, preview_url: 'javascript:alert(1)' }], has_more: false, next_page_token: null } },
        );
        const r = await elevenLabsVoices({ connection: c['eleven'], key: 'sk_test' }, { timeoutMs: 5000 });
        expect(calls.map((x) => x.url)).toEqual(['https://api.elevenlabs.io/v2/voices?page_size=100', 'https://api.elevenlabs.io/v2/voices?page_size=100&next_page_token=p2']);
        expect(r).toEqual({
            ok: true,
            voices: [
                { id: 'a', name: 'Aria', languages: ['en-US', 'hi-IN'], gender: 'female', labels: ['american', 'narration'], previewUrl: 'https://storage.example.com/a.mp3', models: [] },
                // Only an https sample is ever played.
                { id: 'b', name: 'Bo', languages: [], gender: null, labels: [], previewUrl: null, models: [] },
            ],
        });
        fakeFetch({ status: 401, json: { detail: { status: 'invalid_api_key', message: 'Invalid API key' } } });
        expect(await elevenLabsVoices({ connection: c['eleven'], key: 'sk_bad' }, { timeoutMs: 5000 })).toMatchObject({ ok: false, keyRefused: true });
        expect(elevenLabsVoice({ name: 'no id' })).toBeNull();
    });

    it('reads the characters left of the plan as its balance', () => {
        expect(readElevenLabsSubscription({ character_count: 1200, character_limit: 30_000 })).toEqual({ ok: true, balance: 28_800, unit: 'characters' });
        expect(readElevenLabsSubscription({})).toMatchObject({ ok: false });
    });
});

describe('Sarvam', () => {
    it('sends text, language_code, speaker, model and pace to /text-to-speech beside the chat address', async () => {
        const wav = silentWav(2);
        const calls = fakeFetch({ json: { request_id: 'sv-1', audios: [wav.toString('base64')] } });
        const r = await sarvamSpeech({ connection: c['sarvam'], key: 'sv-key-123' }, speech('bulbul:v3', 'priya', { speech: { language: 'hi-IN', speed: 1.25 } }));
        expect(calls[0].url).toBe('https://api.sarvam.ai/text-to-speech');
        expect(header(calls[0], 'api-subscription-key')).toBe('sv-key-123');
        expect(sent(calls[0])).toEqual({ text: 'Hello there.', language_code: 'hi-IN', speaker: 'priya', model: 'bulbul:v3', pace: 1.25 });
        expect(r).toMatchObject({ ok: true, requestId: 'sv-1', files: [{ mimeType: 'audio/wav', seconds: 2 }] });
        fakeFetch({ json: { audios: [mp3(16_000).toString('base64')] } });
        const m = await sarvamSpeech({ connection: c['sarvam'], key: 'k' }, speech('bulbul:v3', 'priya', { speech: { language: 'en-US', format: 'mp3' } }));
        expect(m).toMatchObject({ ok: true, files: [{ mimeType: 'audio/mpeg' }] });
    });

    it('maps Arc\'s language to Sarvam\'s and refuses one it does not speak', async () => {
        expect(sarvamLanguage('en-US')).toBe('en-IN');
        expect(sarvamLanguage('or')).toBe('od-IN');
        expect(sarvamLanguage(undefined)).toBe('en-IN');
        expect(sarvamLanguage('fr-FR')).toBeNull();
        const calls = fakeFetch();
        expect(await sarvamSpeech({ connection: c['sarvam'], key: 'k' }, speech('bulbul:v3', 'priya', { speech: { language: 'fr-FR' } }))).toMatchObject({ ok: false, failure: 'off' });
        expect(calls).toHaveLength(0);
    });

    it('reads 403 as the key, 402 or a quota code as no credit, 429 and 503 as busy', async () => {
        const cases: Array<[number, unknown, Record<string, unknown>]> = [
            [403, { error: { code: 'invalid_api_key_error', message: 'Invalid key' } }, { failure: 'key-refused' }],
            [402, { error: { code: 'insufficient_quota_error', message: 'No credits available.' } }, { failure: 'off', outOfCredit: true }],
            [429, { error: { code: 'insufficient_quota_error', message: 'Quota exceeded' } }, { failure: 'off', outOfCredit: true }],
            [429, { error: { code: 'rate_limit_exceeded_error', message: 'Slow down' } }, { failure: 'unavailable', rateLimited: true }],
            [503, { error: { code: 'model_overloaded', message: 'Busy' } }, { failure: 'unavailable' }],
            [400, { error: { code: 'invalid_request_error', message: 'speaker shubh is not valid for bulbul:v4-flash' } }, { failure: 'off' }],
            [200, { audios: [] }, { failure: 'unreadable' }],
        ];
        for (const [status, json, want] of cases) {
            fakeFetch({ status, json });
            expect(await sarvamSpeech({ connection: c['sarvam'], key: 'k' }, speech('bulbul:v3', 'priya'))).toMatchObject({ ok: false, ...want });
        }
    });

    it('ships its documented speakers: 37 of bulbul:v3 and v4-flash\'s first ones, each with its languages', () => {
        const voices = sarvamVoices();
        const v3 = voices.filter((v) => v.models.includes('bulbul:v3'));
        expect(v3).toHaveLength(37);
        expect(v3.find((v) => v.id === 'priya')).toMatchObject({ name: 'Priya', gender: 'female', previewUrl: null });
        expect(v3.find((v) => v.id === 'shubh')?.languages).toContain('ta-IN');
        expect(voices.find((v) => v.id === 'ishita_hi_ads')).toMatchObject({ name: 'Ishita Hi Ads', languages: ['hi-IN'], models: ['bulbul:v4-flash'] });
        expect(speakerLanguages('shubh_enhi_ads')).toEqual(['en-IN', 'hi-IN']);
    });
});

describe('MiniMax', () => {
    it('sends the voice and settings to t2a_v2 and reads hex audio, its length and billed characters', async () => {
        const audio = mp3(4000);
        const calls = fakeFetch({ json: { data: { audio: audio.toString('hex'), status: 2 }, extra_info: { audio_length: 2350, usage_characters: 14 }, trace_id: 't-9', base_resp: { status_code: 0, status_msg: 'success' } } });
        const r = await miniMaxSpeech({ connection: c['mm'], key: 'mm-key-1234' }, speech('speech-2.8-hd', 'Wise_Woman', { speech: { language: 'ta-IN', speed: 0.8 } }));
        expect(calls[0].url).toBe('https://api.minimax.io/v1/t2a_v2');
        expect(header(calls[0], 'authorization')).toBe('Bearer mm-key-1234');
        expect(sent(calls[0])).toEqual({
            model: 'speech-2.8-hd', text: 'Hello there.', stream: false,
            voice_setting: { voice_id: 'Wise_Woman', speed: 0.8, vol: 1, pitch: 0 },
            audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
            language_boost: 'Tamil', output_format: 'hex',
        });
        expect(r).toMatchObject({ ok: true, requestId: 't-9', usage: { amount: 14 }, files: [{ mimeType: 'audio/mpeg', seconds: 2.4 }] });
        expect((r as { files: Array<{ bytes: Buffer }> }).files[0].bytes.equals(audio)).toBe(true);
    });

    it('reads base_resp codes, since MiniMax answers 200 for most failures', () => {
        expect(readMiniMaxStatus(0, '')).toBeNull();
        expect(readMiniMaxStatus(1004, 'not authorized')).toMatchObject({ failure: 'key-refused' });
        expect(readMiniMaxStatus(2049, 'invalid api key')).toMatchObject({ failure: 'key-refused' });
        expect(readMiniMaxStatus(1008, 'insufficient balance')).toMatchObject({ failure: 'off', outOfCredit: true });
        expect(readMiniMaxStatus(1002, 'rate limit')).toMatchObject({ failure: 'unavailable', rateLimited: true });
        expect(readMiniMaxStatus(1026, 'input sensitive')).toMatchObject({ failure: 'blocked' });
        expect(readMiniMaxStatus(2054, 'voice id not exist')).toMatchObject({ failure: 'off' });
        expect(readMiniMaxStatus(2069, 'model no longer available')).toMatchObject({ failure: 'retired' });
        expect(readMiniMaxStatus(2013, 'invalid params')).toMatchObject({ failure: 'unreadable' });
    });

    it('lists system, cloned and designed voices, with a description given as text or a list', async () => {
        const calls = fakeFetch({ json: { system_voice: [{ voice_id: 'Wise_Woman', voice_name: 'Wise woman', description: ['A calm female voice'] }], voice_cloning: [{ voice_id: 'my-clone', description: 'my own male voice' }], base_resp: { status_code: 0 } } });
        const r = await miniMaxVoices({ connection: c['mm'], key: 'k' }, { timeoutMs: 5000 });
        expect(sent(calls[0])).toEqual({ voice_type: 'all' });
        expect(r).toEqual({ ok: true, voices: [
            { id: 'Wise_Woman', name: 'Wise woman', languages: [], gender: 'female', labels: ['MiniMax voice', 'A calm female voice'], previewUrl: null, models: [] },
            { id: 'my-clone', name: 'my-clone', languages: [], gender: 'male', labels: ['Cloned', 'my own male voice'], previewUrl: null, models: [] },
        ] });
        fakeFetch({ json: { base_resp: { status_code: 2049, status_msg: 'invalid api key' } } });
        expect(await miniMaxVoices({ connection: c['mm'], key: 'k' }, { timeoutMs: 5000 })).toMatchObject({ ok: false, keyRefused: true });
    });
});

describe('Google Cloud Text-to-Speech', () => {
    it('uses the EU address for a European location and signs with the service account', async () => {
        expect(googleTtsHost('europe-west4')).toBe('eu-texttospeech.googleapis.com');
        expect(googleTtsHost('eu')).toBe('eu-texttospeech.googleapis.com');
        expect(googleTtsHost('us')).toBe('texttospeech.googleapis.com');
        const audio = mp3(8000);
        const calls = fakeFetch({ json: { audioContent: audio.toString('base64') } });
        const r = await googleTtsSpeech({ connection: c['google'], key: null }, speech('tts-chirp3-hd', 'hi-IN-Chirp3-HD-Kore', { speech: { language: 'en-US', speed: 1.1 } }));
        expect(calls[0].url).toBe('https://eu-texttospeech.googleapis.com/v1/text:synthesize');
        expect(header(calls[0], 'authorization')).toBe('Bearer ya29.token');
        // The voice's own language goes with it, not the call's.
        expect(sent(calls[0])).toEqual({ input: { text: 'Hello there.' }, voice: { languageCode: 'hi-IN', name: 'hi-IN-Chirp3-HD-Kore' }, audioConfig: { audioEncoding: 'MP3', speakingRate: 1.1 } });
        expect(r).toMatchObject({ ok: true, files: [{ mimeType: 'audio/mpeg', seconds: 0.5 }] });
        expect(googleTtsBody('en-US-Neural2-A', 'Hi', { format: 'wav' })).toMatchObject({ audioConfig: { audioEncoding: 'LINEAR16' } });
    });

    it('refuses a voice of another type before anything is sent, since it would bill at that type\'s price', async () => {
        const calls = fakeFetch();
        expect(await googleTtsSpeech({ connection: c['google'], key: null }, speech('tts-standard', 'en-US-Chirp3-HD-Kore'))).toMatchObject({ ok: false, failure: 'off' });
        expect(await googleTtsSpeech({ connection: c['google'], key: null }, speech('gemini-tts', 'en-US-Chirp3-HD-Kore'))).toMatchObject({ ok: false, failure: 'retired' });
        expect(calls).toHaveLength(0);
    });

    it('says to switch the API on when the service account is refused, and reads 429 as busy', async () => {
        fakeFetch({ status: 403, json: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Cloud Text-to-Speech API has not been used in project 1' } } });
        const r = await googleTtsSpeech({ connection: c['googleus'], key: null }, speech('tts-chirp3-hd', 'en-US-Chirp3-HD-Kore'));
        expect(r).toMatchObject({ ok: false, failure: 'off' });
        expect((r as { detail: string }).detail).toContain('Cloud Text-to-Speech API');
        fakeFetch({ status: 429, json: { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota' } } });
        expect(await googleTtsSpeech({ connection: c['googleus'], key: null }, speech('tts-chirp3-hd', 'en-US-Chirp3-HD-Kore'))).toMatchObject({ ok: false, failure: 'unavailable', rateLimited: true });
    });

    it('lists only the voice types Arc prices, each with its model', async () => {
        fakeFetch({ json: { voices: [
            { name: 'en-US-Chirp3-HD-Kore', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
            { name: 'en-US-Neural2-D', languageCodes: ['en-US'], ssmlGender: 'MALE' },
            { name: 'en-US-Polyglot-1', languageCodes: ['en-US'], ssmlGender: 'MALE' },
        ] } });
        const r = await googleTtsVoices({ connection: c['googleus'], key: null }, { timeoutMs: 5000 });
        expect(r).toEqual({ ok: true, voices: [
            { id: 'en-US-Chirp3-HD-Kore', name: 'en-US-Chirp3-HD-Kore', languages: ['en-US'], gender: 'female', labels: ['Chirp3-HD'], previewUrl: null, models: ['tts-chirp3-hd'] },
            { id: 'en-US-Neural2-D', name: 'en-US-Neural2-D', languages: ['en-US'], gender: 'male', labels: ['Neural2'], previewUrl: null, models: ['tts-neural2'] },
        ] });
    });
});

describe('an audio file\'s length', () => {
    it('is read from a WAV header and an MP3\'s first frame, after an ID3 tag', () => {
        expect(wavSeconds(silentWav(3))).toBe(3);
        expect(wavSeconds(Buffer.from('not a wav at all, no RIFF here, padding padding'))).toBeNull();
        expect(mp3Seconds(mp3(48_000))).toBe(3);
        const id3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 10]), Buffer.alloc(10), mp3(16_000)]);
        expect(mp3Seconds(id3)).toBe(1);
        expect(mp3Seconds(Buffer.alloc(100))).toBeNull();
    });
});
