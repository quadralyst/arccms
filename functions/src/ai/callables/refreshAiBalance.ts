/**
 * Admin: read a connection's balance now (Settings, AI, Refresh; specs/ai-media-spec.md,
 * AM-D32). Only for providers whose own key can read it.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAdmin } from '../../search/auth.js';
import { refreshBalance } from '../balances.js';
import { forgetAiSettings, readAiSettings } from '../settings.js';

export const refreshAiBalance = onCall({ timeoutSeconds: 30 }, async (request) => {
    await requireAdmin(request);
    forgetAiSettings();
    const settings = await readAiSettings();
    const id = request.data?.connection;
    const connection = typeof id === 'string' ? settings.connections[id] : undefined;
    if (!connection) throw new HttpsError('not-found', 'Save the connection first.');
    const read = await refreshBalance(connection);
    forgetAiSettings();
    return read.ok ? { ok: true, balance: read.balance, unit: read.unit } : { ok: false, detail: read.detail };
});
