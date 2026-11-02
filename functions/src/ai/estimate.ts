/**
 * What a call would cost, from the price list, before it is made (specs/ai-media-spec.md,
 * AM-D6, AM-D21): for the Media Manager's "About $0.17 for 4 pictures", and for an app's own
 * "this will cost" line through `estimateAiCost`. Pictures, characters and seconds are known
 * before the call; tokens are not, so a model billed by tokens is estimated from a typical
 * figure and the estimate says "about". It is never a promise: a provider's own figure, the
 * file's real length or a fallback to another model can change it.
 */
import { fittedImage, picturePrice, tokensPerPicture } from './images.js';
import { audioSkip, DEFAULT_AUDIO_SECONDS, fittedAudio } from './audios.js';
import { DEFAULT_VIDEO_SECONDS, fittedVideo, secondPrice } from './videos.js';
import { findPurpose, isFileKind, purposeKind, purposeTier } from './purposes.js';
import { modelInfo, purposeSettings, readAiSettings, type AiModelInfo, type AiModelRef, type AiSettings } from './settings.js';
import type { AiAudioSettings, AiImageSettings, AiKind, AiPurpose, AiSpeechSettings, AiUnit, AiVideoSettings } from './types.js';

/** A text answer's typical length, when the purpose sets no limit. */
const TYPICAL_OUT_TOKENS = 1000;
/** About four characters a token, across the languages Arc's sites use. */
const CHARS_PER_TOKEN = 4;

export interface AiEstimate {
    /** USD; 0 when the model has no price (`priced: false`). */
    usd: number;
    /** A figure for a model billed by tokens, or a text answer's length: not exact. */
    about: boolean;
    /** False when the model has no price, or its currency has no USD rate yet. */
    priced: boolean;
    amount: number;
    unit: AiUnit;
    /** The model the estimate is for; null when no model could answer. */
    model: AiModelRef | null;
}

export interface EstimateSettings {
    image?: AiImageSettings;
    speech?: AiSpeechSettings;
    audio?: AiAudioSettings;
    video?: AiVideoSettings;
}

/** The estimate for one model, from what the call asks. */
export function estimateFor(info: AiModelInfo, kind: AiKind, settings: EstimateSettings, chars: number, maxOutputTokens?: number): Omit<AiEstimate, 'model'> {
    const rate = info.usdRate;
    const priced = (inCurrency: number | undefined, amount: number, unit: AiUnit, about: boolean): Omit<AiEstimate, 'model'> => (
        inCurrency === undefined || rate === null
            ? { usd: 0, about, priced: false, amount, unit }
            : { usd: inCurrency * rate, about, priced: true, amount, unit }
    );
    if (kind === 'image') {
        const image = fittedImage(settings.image, info.image);
        const count = image.count ?? 1;
        if (info.unit === 'tokens') {
            const tokens = tokensPerPicture(info.image, image);
            const out = tokens === undefined ? undefined : tokens * count;
            const price = out === undefined || info.priceOut === undefined ? undefined : (out * info.priceOut + Math.ceil(chars / CHARS_PER_TOKEN) * (info.priceIn ?? 0)) / 1_000_000;
            return priced(price, count, 'pictures', true);
        }
        const each = picturePrice(info.image, info.price, image);
        return priced(each === undefined ? undefined : each * count, count, 'pictures', false);
    }
    if (info.unit === 'characters') return priced(info.price === undefined ? undefined : (chars / 1000) * info.price, chars, 'characters', false);
    if (kind === 'video') {
        const video = fittedVideo(settings.video, info.video);
        const seconds = video.seconds ?? DEFAULT_VIDEO_SECONDS;
        if (info.unit === 'tokens') {
            const out = info.video?.tokensPerSecond === undefined ? undefined : info.video.tokensPerSecond * seconds;
            return priced(out === undefined || info.priceOut === undefined ? undefined : (out * info.priceOut) / 1_000_000, seconds, 'seconds', true);
        }
        const each = secondPrice(info.video, info.price, video);
        return priced(each === undefined ? undefined : each * seconds, seconds, 'seconds', false);
    }
    if (info.unit === 'seconds') {
        const seconds = fittedAudio(settings.audio, info.audio).seconds ?? DEFAULT_AUDIO_SECONDS;
        return priced(info.price === undefined ? undefined : seconds * info.price, seconds, 'seconds', false);
    }
    if (info.unit === 'pictures') return priced(info.price, 1, 'pictures', false);
    const tokensIn = Math.ceil(chars / CHARS_PER_TOKEN);
    const tokensOut = maxOutputTokens ?? TYPICAL_OUT_TOKENS;
    const price = info.priceIn === undefined || info.priceOut === undefined ? undefined : (tokensIn * info.priceIn + tokensOut * info.priceOut) / 1_000_000;
    return priced(price, tokensIn + tokensOut, 'tokens', true);
}

/** The models a purpose's call would try, in order, that make its kind. */
export function purposeModels(settings: AiSettings, purposeId: string, purpose: AiPurpose): AiModelRef[] {
    const kind = purposeKind(purpose);
    const ps = purposeSettings(settings, purposeId);
    const list = ps.models.length ? ps.models : isFileKind(kind) ? settings.lists[kind] : settings.tiers[purposeTier(purpose)];
    const wanted = isFileKind(kind) ? kind : 'text';
    const makes = list.filter((ref) => {
        const info = modelInfo(settings, ref);
        // A sound purpose never asks a music model, nor the other way round.
        if (kind === 'audio' && audioSkip({ ...purpose.audio, type: purpose.audio?.type ?? 'sound' }, info.audio, purpose.timeoutSeconds ?? 60)) return false;
        return info.makes === wanted || (wanted === 'text' && info.makes === 'data');
    });
    return purpose.fallback === false ? makes.slice(0, 1) : makes;
}

/**
 * What one call of a purpose would cost with its first model (or `model`), from the price
 * list. For an app's own "this will cost" line; see docs/app/ai.html.
 */
export async function estimateAiCost(input: { purpose: string; input?: string; model?: AiModelRef } & EstimateSettings): Promise<AiEstimate> {
    const purpose = findPurpose(input.purpose);
    if (!purpose) throw new Error(`estimateAiCost: no purpose "${input.purpose}" in functions/src/custom/ai.ts.`);
    const settings = await readAiSettings();
    const kind = purposeKind(purpose);
    const models = purposeModels(settings, input.purpose, purpose);
    const ref = input.model && models.some((m) => m.connection === input.model!.connection && m.model === input.model!.model) ? input.model : models[0];
    const fileSettings: EstimateSettings = {
        image: { ...purpose.image, ...input.image },
        speech: { ...purpose.speech, ...input.speech },
        audio: { ...purpose.audio, ...input.audio },
        video: { ...purpose.video, ...input.video },
    };
    const chars = typeof input.input === 'string' ? input.input.length : 0;
    if (!ref) return { usd: 0, about: false, priced: false, amount: 0, unit: kind === 'image' ? 'pictures' : 'tokens', model: null };
    return { ...estimateFor(modelInfo(settings, ref), kind, fileSettings, chars, purpose.maxOutputTokens), model: ref };
}
