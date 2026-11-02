/**
 * Admin: a presenter connection's avatars (Settings, AI, Avatars; specs/ai-media-spec.md,
 * AM-D33): each look's name, gender, picture and its own voice. Read from the provider's list
 * call, which sends nothing of the site's and costs nothing, so in test mode too. Kept in
 * memory 10 minutes per connection and key. For a provider Arc makes no text with, a list read
 * with the key is the connection's test.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAdmin } from '../../search/auth.js';
import { avatarListerFor } from '../connectors/index.js';
import type { AiAvatar } from '../connectors/types.js';
import { readKey } from '../keys.js';
import { findPreset, presetNeedsKey } from '../presets.js';
import { forgetAiSettings, readAiSettings } from '../settings.js';
import { noteConnection } from '../usage.js';

const KEEP_MS = 10 * 60_000;
const TIMEOUT_MS = 45_000;
const MAX_AVATARS = 1000;

const kept = new Map<string, { at: number; avatars: AiAvatar[] }>();

/** For tests: forget the kept lists. */
export function forgetAvatarLists(): void {
    kept.clear();
}

export const aiAvatars = onCall({ timeoutSeconds: 60 }, async (request) => {
    await requireAdmin(request);
    forgetAiSettings();
    const settings = await readAiSettings();
    const id = request.data?.connection;
    const connection = typeof id === 'string' ? settings.connections[id] : undefined;
    const preset = connection ? findPreset(connection.preset) : undefined;
    if (!connection || !preset) throw new HttpsError('not-found', 'Save the connection first.');
    const lister = await avatarListerFor(preset);
    if (!lister) throw new HttpsError('failed-precondition', `${preset.label} makes no presenter videos in Arc.`);
    const at = `${connection.id}|${connection.keySetAt ?? ''}`;
    const hit = kept.get(at);
    if (hit && request.data?.fresh !== true && Date.now() - hit.at < KEEP_MS) return { ok: true, avatars: hit.avatars };
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
    await noteConnection(settings, connection.id, null);
    const avatars = result.avatars.slice(0, MAX_AVATARS).sort((a, b) => a.name.localeCompare(b.name));
    kept.set(at, { at: Date.now(), avatars });
    return { ok: true, avatars };
});
