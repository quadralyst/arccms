/**
 * Video (specs/ai-media-spec.md, AM-D19, AM-D4, AM-D5): the call's settings fitted to each
 * model before it is asked, as for pictures: the nearest shape and resolution it makes, a
 * length inside its range, sound only where it has a choice. A first frame, a seed, a negative
 * prompt or a presenter skips a model that cannot take it. Pure, so the estimate and the call
 * agree.
 */
import { nearestAspect } from './images.js';
import type { AiVideoAbilities, AiVideoResolution } from './presets.js';
import type { AiVideoSettings } from './types.js';

const RESOLUTIONS: AiVideoResolution[] = ['480p', '720p', '1080p', '4k'];
export const DEFAULT_VIDEO_SECONDS = 8;

/** The resolution of `made` nearest to `wanted`, the lower one on a tie. */
export function nearestResolution(wanted: AiVideoResolution, made: readonly AiVideoResolution[]): AiVideoResolution {
    if (!made.length || made.includes(wanted)) return wanted;
    const at = RESOLUTIONS.indexOf(wanted);
    return [...made].sort((a, b) => Math.abs(RESOLUTIONS.indexOf(a) - at) - Math.abs(RESOLUTIONS.indexOf(b) - at) || RESOLUTIONS.indexOf(a) - RESOLUTIONS.indexOf(b))[0];
}

/** The settings a video model is asked with; a model Arc knows nothing of gets the call's as they are. */
export function fittedVideo(video: AiVideoSettings = {}, abilities: AiVideoAbilities | undefined): AiVideoSettings {
    const seconds = video.seconds ?? DEFAULT_VIDEO_SECONDS;
    if (!abilities) return { ...video, seconds };
    const out: AiVideoSettings = {
        seconds: Math.min(abilities.seconds.max, Math.max(abilities.seconds.min, Math.round(seconds))),
        aspect: nearestAspect(video.aspect ?? '16:9', abilities.aspects),
        resolution: nearestResolution(video.resolution ?? '720p', abilities.resolutions),
        sound: abilities.sound === 'always' ? true : abilities.sound === 'never' ? false : video.sound === true,
    };
    if (video.seed !== undefined && abilities.seed) out.seed = video.seed;
    if (video.negativePrompt && abilities.negativePrompt) out.negativePrompt = video.negativePrompt;
    if (video.presenter) out.presenter = true;
    return out;
}

/** Why a video model cannot take this call, or null (AM-D4). */
export function videoSkip(video: AiVideoSettings = {}, abilities: AiVideoAbilities | undefined, firstFrame: boolean): string | null {
    if (!abilities) return null;
    if (video.presenter && !abilities.presenter) return 'makes no presenter videos';
    if (!video.presenter && abilities.presenter) return 'makes only presenter videos';
    if (firstFrame && !abilities.firstFrame) return 'starts from no picture';
    if (video.seed !== undefined && !abilities.seed) return 'takes no seed';
    if (video.negativePrompt?.trim() && !abilities.negativePrompt) return 'takes no negative prompt';
    // A video that must be silent from a model that always makes sound, or the other way round.
    if (video.sound === false && abilities.sound === 'always') return 'always makes sound';
    if (video.sound === true && abilities.sound === 'never') return 'makes no sound';
    return null;
}

/** The price of a second in the model's currency: by resolution, with sound where it costs more, else the one price. */
export function secondPrice(abilities: AiVideoAbilities | undefined, price: number | undefined, video: AiVideoSettings = {}): number | undefined {
    const r = video.resolution ?? '720p';
    if (video.sound && abilities?.priceWithSound?.[r] !== undefined) return abilities.priceWithSound[r];
    return abilities?.priceByResolution?.[r] ?? price;
}
