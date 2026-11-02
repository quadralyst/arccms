/**
 * Admin: a speech connection's voices (Settings, AI, Voices; specs/ai-media-spec.md, AM-D18):
 * name, languages, gender, labels, and the provider's own sample where it has one. Read from
 * the provider's list call (ElevenLabs, Google Cloud, MiniMax), which sends nothing of the
 * site's and costs nothing, so it is read in test mode too; Sarvam has no list call, so Arc
 * ships its documented list. Kept in memory 10 minutes per connection and key. A list read
 * with the key shows on the connection's card as its last success, a refused key as its
 * error, as a test would: for a provider Arc makes no text with, it is the connection's test.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAdmin } from '../../search/auth.js';
import { connectorFor, voiceListerFor } from '../connectors/index.js';
import { readKey } from '../keys.js';
import { findPreset, presetNeedsKey } from '../presets.js';
import { forgetAiSettings, readAiSettings } from '../settings.js';
import { noteConnection } from '../usage.js';
import type { AiVoice } from '../types.js';

const KEEP_MS = 10 * 60_000;
/** The whole list, every page of it: inside the callable's 60 seconds. */
const TIMEOUT_MS = 45_000;
const MAX_VOICES = 2000;

const kept = new Map<string, { at: number; voices: AiVoice[] }>();

/** For tests: forget the kept lists. */
export function forgetVoiceLists(): void {
    kept.clear();
}

export const aiVoices = onCall({ timeoutSeconds: 60 }, async (request) => {
    await requireAdmin(request);
    // A connection saved a moment ago, from another instance, must be found with its key.
    forgetAiSettings();
    const settings = await readAiSettings();
    const id = request.data?.connection;
    const connection = typeof id === 'string' ? settings.connections[id] : undefined;
    const preset = connection ? findPreset(connection.preset) : undefined;
    if (!connection || !preset) throw new HttpsError('not-found', 'Save the connection first.');
    const lister = await voiceListerFor(preset);
    if (!lister) throw new HttpsError('failed-precondition', `${preset.label} makes no speech in Arc.`);
    // A new key may see other voices (its own clones): it gets its own list.
    const at = `${connection.id}|${connection.keySetAt ?? ''}`;
    const fresh = request.data?.fresh === true;
    const hit = kept.get(at);
    if (hit && !fresh && Date.now() - hit.at < KEEP_MS) return { ok: true, voices: hit.voices };
    let key: string | null = null;
    if (presetNeedsKey(preset) && connection.keyPreview) {
        const read = await readKey(connection, Date.now(), { fresh: true });
        if (read.ok) key = read.key;
    }
    const result = await lister({ connection, key }, { timeoutMs: TIMEOUT_MS });
    if (!result.ok) {
        if (result.keyRefused) await noteConnection(settings, connection.id, result.detail);
        return { ok: false, detail: result.detail.slice(0, 300) };
    }
    // A list read with the key is the test only of a provider Arc makes no text with: Vertex's
    // voices say nothing of whether Gemini answers.
    if (!result.fromDocs && !connectorFor(preset.kind)) await noteConnection(settings, connection.id, null);
    const voices = result.voices.slice(0, MAX_VOICES).sort((a, b) => a.name.localeCompare(b.name));
    kept.set(at, { at: Date.now(), voices });
    return { ok: true, voices };
});
