/**
 * Named voices (specs/ai-media-spec.md, AM-D17): a speech purpose names its voices, such as
 * `narrator`, with the voice id each provider uses for it; the admin may change each one in
 * Settings, AI. A call asks for a voice by name, so the app's code stays the same whichever
 * provider answers. A model whose provider has no id for the asked name is skipped.
 */

/** A voice name: what an app's code passes as `voice`. */
export const VOICE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
/** A provider's voice id: printable, no spaces at the ends, no path tricks. */
export const VOICE_ID = /^[A-Za-z0-9][A-Za-z0-9 ._:@()-]{0,119}$/;
/** The preset ids a voice map may name: every preset that makes speech. */
export const SPEECH_PRESETS = ['elevenlabs', 'sarvam', 'minimax', 'vertex'] as const;
/** The one voice of a speech purpose that names none, for the admin to map. */
export const DEFAULT_VOICE = 'default';

/**
 * The voice id a preset uses for a voice name: the admin's, else the app's, else null (the
 * model is skipped).
 */
export function voiceIdFor(name: string, preset: string, app: Record<string, Record<string, string>> | undefined, admin: Record<string, Record<string, string>>): string | null {
    const own = Object.prototype.hasOwnProperty.call(admin, name) ? admin[name][preset] : undefined;
    if (own) return own;
    const code = app && Object.prototype.hasOwnProperty.call(app, name) ? app[name][preset] : undefined;
    return typeof code === 'string' && VOICE_ID.test(code) ? code : null;
}
