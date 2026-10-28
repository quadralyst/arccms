/**
 * Admin: check a connection and model with one tiny live call (Settings, AI, Test), in test
 * mode as well, so a key can be tried before the site goes live. It costs a fraction of a
 * cent, is recorded like any call as purpose `arc-connection-test` and counts toward the
 * month's totals.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAdmin } from '../../search/auth.js';
import { connectorFor } from '../connectors/index.js';
import type { ConnectorResult } from '../connectors/types.js';
import { readKey } from '../keys.js';
import { findPreset } from '../presets.js';
import { writeAiCall, type AiCallRecord } from '../records.js';
import { forgetAiSettings, modelInfo, readAiSettings } from '../settings.js';
import { addToTotals, noteConnection } from '../usage.js';

export const CONNECTION_TEST_PURPOSE = 'arc-connection-test';
const TIMEOUT_MS = 30_000;

export const testAiConnection = onCall({ timeoutSeconds: 60 }, async (request) => {
    await requireAdmin(request);
    const connectionId = request.data?.connection;
    const model = typeof request.data?.model === 'string' ? request.data.model.trim().slice(0, 120) : '';
    if (!model) throw new HttpsError('invalid-argument', 'Name the model to test, such as qwen3-vl-plus.');
    forgetAiSettings();
    const settings = await readAiSettings();
    const connection = typeof connectionId === 'string' ? settings.connections[connectionId] : undefined;
    const preset = connection ? findPreset(connection.preset) : undefined;
    if (!connection || !preset) throw new HttpsError('not-found', 'Save the connection first, then test it.');

    const started = Date.now();
    let result: ConnectorResult;
    const key = preset.kind === 'openai' ? await readKey(connection) : { ok: true as const, key: null };
    if (!key.ok) result = { ok: false, failure: 'off', detail: key.detail };
    else {
        result = await connectorFor(preset.kind)({ connection, key: key.key }, {
            model,
            instruction: 'Reply with the word OK and nothing else.',
            parts: [{ kind: 'text', text: 'Are you there?' }],
            schema: null,
            schemaSupport: modelInfo(settings, { connection: connection.id, model }).schema,
            maxOutputTokens: 20,
            timeoutMs: TIMEOUT_MS,
        });
    }
    const ms = Date.now() - started;
    const usage = result.usage ?? { tokensIn: 0, tokensOut: 0, tokensThinking: 0 };
    const info = modelInfo(settings, { connection: connection.id, model });
    const costUsd = usage.costUsd ?? (info.priceIn !== undefined && info.priceOut !== undefined ? (usage.tokensIn * info.priceIn + usage.tokensOut * info.priceOut) / 1_000_000 : 0);
    const record: AiCallRecord = {
        purpose: CONNECTION_TEST_PURPOSE,
        tier: 'cheap',
        test: false,
        ref: null,
        limitKey: null,
        units: 1,
        input: { chars: 14, files: 0, bytes: 0 },
        attempts: [{ connection: connection.id, model, outcome: result.ok ? 'ok' : result.failure, ms, ...(result.ok ? {} : { detail: result.detail.slice(0, 300) }) }],
        connection: connection.id,
        model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        tokensThinking: usage.tokensThinking,
        costUsd,
        costFrom: usage.costUsd !== undefined ? 'provider' : info.priceIn !== undefined ? 'price-list' : 'none',
        ms,
        outcome: result.ok ? 'ok' : result.failure === 'retired' || result.failure === 'key-refused' ? 'unavailable' : result.failure,
        ...(result.ok ? {} : { detail: result.detail.slice(0, 500) }),
    };
    await writeAiCall(record, null);
    await addToTotals(record);
    await noteConnection(settings, connection.id, result.ok ? null : result.detail);
    forgetAiSettings();
    return result.ok
        ? { ok: true, ms, reply: result.text.trim().slice(0, 80), tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd }
        : { ok: false, ms, failure: result.failure, detail: result.detail.slice(0, 300) };
});
