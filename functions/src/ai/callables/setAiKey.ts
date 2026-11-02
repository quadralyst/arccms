/**
 * Admin: set or replace a connection's key (Settings, AI; specs/ai-spec.md, AI-D8). The key
 * goes to AiKeys, which no browser can read; the connection in Settings/ai gets only its
 * preview, who set it and when. Takes effect within a minute, with no deploy.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../init.js';
import { requireAdmin } from '../../search/auth.js';
import { cleanKey, keyPreview, storeKey } from '../keys.js';
import { findPreset, presetNeedsKey } from '../presets.js';
import { AI_SETTINGS_DOC, connectionBaseUrl, forgetAiSettings, readAiSettings } from '../settings.js';

export const setAiKey = onCall(async (request) => {
    await requireAdmin(request);
    const connectionId = request.data?.connection;
    const key = cleanKey(request.data?.key);
    if (!key) throw new HttpsError('invalid-argument', 'Paste the whole key: 8 to 400 characters, no spaces.');
    forgetAiSettings();
    const settings = await readAiSettings();
    const connection = typeof connectionId === 'string' ? settings.connections[connectionId] : undefined;
    if (!connection) throw new HttpsError('not-found', 'Save the connection first, then set its key.');
    const preset = findPreset(connection.preset);
    if (!preset || !presetNeedsKey(preset)) throw new HttpsError('failed-precondition', 'This connection uses the project\'s own Google account and needs no key.');
    if (!connectionBaseUrl(connection)) throw new HttpsError('failed-precondition', 'Fill in the connection\'s address (or workspace) first, then set its key.');
    const setBy = String(request.auth?.token?.['email'] ?? request.auth?.uid ?? 'an admin');
    const now = new Date().toISOString();
    await storeKey(connection, key, setBy, now);
    await db.collection('Settings').doc(AI_SETTINGS_DOC).update({
        [`connections.${connection.id}.keyPreview`]: keyPreview(key),
        [`connections.${connection.id}.keySetAt`]: now,
        [`connections.${connection.id}.keySetBy`]: setBy,
        [`connections.${connection.id}.lastError`]: null,
    });
    forgetAiSettings();
    return { keyPreview: keyPreview(key), keySetAt: now, keySetBy: setBy };
});
