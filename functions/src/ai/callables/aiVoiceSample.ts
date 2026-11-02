/**
 * Admin: a short sample of a voice, for a provider with no sample file of its own (Settings,
 * AI, Play; specs/ai-media-spec.md, AM-D18). One sentence in the voice's language, made by
 * the chosen model as Arc's own purpose `arc-voice-sample`: recorded and counted toward the
 * month's budget like any call (a few characters), and cached for a year, so each voice is
 * paid for once. In test mode it is a stand-in of silence, as every test call is.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAdmin } from '../../search/auth.js';
import { askAiForArc } from '../askAi.js';
import { modelInfo, readAiSettings } from '../settings.js';
import { VOICE_ID } from '../voices.js';

export const VOICE_SAMPLE_PURPOSE = 'arc-voice-sample';

/** One sentence by language: what a sample says. */
const SAMPLES: Record<string, string> = {
    en: 'Hello, this is a sample of my voice.',
    hi: 'नमस्ते, यह मेरी आवाज़ का एक नमूना है।',
    bn: 'নমস্কার, এটি আমার কণ্ঠের একটি নমুনা।',
    ta: 'வணக்கம், இது என் குரலின் ஒரு மாதிரி.',
    te: 'నమస్కారం, ఇది నా గొంతు యొక్క ఒక నమూనా.',
    mr: 'नमस्कार, हा माझ्या आवाजाचा एक नमुना आहे.',
    gu: 'નમસ્તે, આ મારા અવાજનો એક નમૂનો છે.',
    kn: 'ನಮಸ್ಕಾರ, ಇದು ನನ್ನ ಧ್ವನಿಯ ಒಂದು ಮಾದರಿ.',
    ml: 'നമസ്കാരം, ഇത് എന്റെ ശബ്ദത്തിന്റെ ഒരു മാതൃകയാണ്.',
    pa: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਇਹ ਮੇਰੀ ਆਵਾਜ਼ ਦਾ ਇੱਕ ਨਮੂਨਾ ਹੈ।',
    od: 'ନମସ୍କାର, ଏହା ମୋ ସ୍ୱରର ଏକ ନମୁନା।',
    or: 'ନମସ୍କାର, ଏହା ମୋ ସ୍ୱରର ଏକ ନମୁନା।',
    fr: 'Bonjour, voici un exemple de ma voix.',
    de: 'Hallo, das ist eine Probe meiner Stimme.',
    es: 'Hola, esta es una muestra de mi voz.',
    it: 'Ciao, questo è un esempio della mia voce.',
    pt: 'Olá, esta é uma amostra da minha voz.',
    nl: 'Hallo, dit is een voorbeeld van mijn stem.',
    ja: 'こんにちは、これは私の声のサンプルです。',
    zh: '你好，这是我的声音示例。',
    ar: 'مرحبا، هذه عينة من صوتي.',
};

/** The sentence for a language tag, English when Arc has none in that language. */
export function sampleSentence(language: string | undefined): string {
    const code = language?.split('-')[0]?.toLowerCase() ?? 'en';
    return SAMPLES[code] ?? SAMPLES['en'];
}

export const aiVoiceSample = onCall({ timeoutSeconds: 90, memory: '512MiB' }, async (request) => {
    await requireAdmin(request);
    const settings = await readAiSettings();
    const connection = typeof request.data?.connection === 'string' ? settings.connections[request.data.connection] : undefined;
    if (!connection) throw new HttpsError('not-found', 'Save the connection first.');
    const model = typeof request.data?.model === 'string' ? request.data.model.trim().slice(0, 120) : '';
    const voice = typeof request.data?.voice === 'string' ? request.data.voice.trim() : '';
    if (!model || modelInfo(settings, { connection: connection.id, model }).makes !== 'speech') throw new HttpsError('invalid-argument', 'Choose a speech model of this connection.');
    if (!VOICE_ID.test(voice)) throw new HttpsError('invalid-argument', 'Choose a voice.');
    const language = typeof request.data?.language === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(request.data.language) ? request.data.language : undefined;
    const r = await askAiForArc(
        { purpose: VOICE_SAMPLE_PURPOSE, input: sampleSentence(language), ...(language ? { speech: { language } } : {}) },
        { only: { connection: connection.id, model }, voiceId: voice },
    );
    if (r.ok !== true) return { ok: false, reason: r.reason, detail: (r.detail ?? '').slice(0, 300) };
    const file = r.files?.[0];
    if (!file) return { ok: false, reason: 'unreadable', detail: 'no sample was made' };
    return { ok: true, path: file.path, mimeType: file.mimeType, cached: r.cached === true, test: r.usage.test, costUsd: r.usage.costUsd };
});
