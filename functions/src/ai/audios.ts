/**
 * Other audio (specs/ai-media-spec.md, AM5): sound effects and music, fitted to each model as
 * pictures and video are. A sound purpose never gets music, nor the other way round; a loop
 * goes only to a model that makes one; the length is kept inside the model's range. Music is
 * made while the call waits (ElevenLabs answers it in the same request), so a piece longer
 * than the purpose's time can cover skips the model rather than timing out after being billed.
 */
import type { AiAudioAbilities } from './presets.js';
import type { AiAudioSettings } from './types.js';

export const DEFAULT_AUDIO_SECONDS = 10;
/** Time a music request needs beyond its length: music takes about as long to make as to play. */
export const MUSIC_MARGIN_SECONDS = 30;

/** The settings an audio model is asked with; a model Arc knows nothing of gets the call's as they are. */
export function fittedAudio(audio: AiAudioSettings = {}, abilities: AiAudioAbilities | undefined): AiAudioSettings {
    const seconds = audio.seconds ?? DEFAULT_AUDIO_SECONDS;
    if (!abilities) return { ...audio, seconds };
    const out: AiAudioSettings = {
        type: abilities.type,
        seconds: Math.min(abilities.seconds.max, Math.max(abilities.seconds.min, seconds)),
        format: audio.format && abilities.formats.includes(audio.format) ? audio.format : abilities.formats[0],
    };
    if (audio.loop && abilities.loop) out.loop = true;
    if (audio.instrumental && abilities.instrumental) out.instrumental = true;
    return out;
}

/** Why an audio model cannot take this call, or null (AM-D4). */
export function audioSkip(audio: AiAudioSettings = {}, abilities: AiAudioAbilities | undefined, timeoutSeconds: number): string | null {
    if (!abilities) return null;
    if (audio.type && audio.type !== abilities.type) return abilities.type === 'music' ? 'makes music, not sound effects' : 'makes sound effects, not music';
    if (audio.loop && !abilities.loop) return 'makes no loops';
    const seconds = Math.min(abilities.seconds.max, Math.max(abilities.seconds.min, audio.seconds ?? DEFAULT_AUDIO_SECONDS));
    if (abilities.type === 'music' && seconds + MUSIC_MARGIN_SECONDS > timeoutSeconds) {
        return `the purpose's timeoutSeconds (${timeoutSeconds}) cannot cover ${seconds} seconds of music: set it to at least ${Math.min(540, seconds + MUSIC_MARGIN_SECONDS)}`;
    }
    return null;
}
