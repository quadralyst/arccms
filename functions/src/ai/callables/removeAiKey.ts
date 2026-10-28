/**
 * Admin: remove a connection's key (Settings, AI; specs/ai-spec.md, AI-D8). The page calls it
 * before it deletes a connection, so no key is left behind; the daily cleanup removes any
 * key whose connection is gone.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../init.js';
import { requireAdmin } from '../../search/auth.js';
import { deleteKey } from '../keys.js';
import { AI_SETTINGS_DOC, forgetAiSettings } from '../settings.js';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const removeAiKey = onCall(async (request) => {
    await requireAdmin(request);
    const connectionId = request.data?.connection;
    if (typeof connectionId !== 'string' || !ID.test(connectionId)) throw new HttpsError('invalid-argument', 'Name the connection whose key to remove.');
    await deleteKey(connectionId);
    const ref = db.collection('Settings').doc(AI_SETTINGS_DOC);
    const snap = await ref.get();
    if (snap.exists && (snap.data()?.['connections'] ?? {})[connectionId]) {
        await ref.update({
            [`connections.${connectionId}.keyPreview`]: FieldValue.delete(),
            [`connections.${connectionId}.keySetAt`]: FieldValue.delete(),
            [`connections.${connectionId}.keySetBy`]: FieldValue.delete(),
        });
    }
    forgetAiSettings();
    return { removed: true };
});
