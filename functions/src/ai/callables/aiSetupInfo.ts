/**
 * Admin: what Settings, AI needs from the server (specs/ai-spec.md, AI-D2, AI-D6): the app's
 * purposes as the page shows them (what each takes and gives, its tier and allowance, never
 * the instruction or the test answer, which stay on the server), and the providers Arc
 * offers, with the models it knows, what they read and cost.
 */
import { onCall } from 'firebase-functions/v2/https';
import { requireAdmin } from '../../search/auth.js';
import { AI_PRESETS, PRICES_CHECKED_ON } from '../presets.js';
import { aiPurposes, DEFAULT_TEXT_CHARS, DEFAULT_TIMEOUT_SECONDS, purposeTier } from '../purposes.js';
import { defaultVertexLocation } from '../settings.js';

export const aiSetupInfo = onCall(async (request) => {
    await requireAdmin(request);
    return {
        purposes: Object.entries(aiPurposes()).map(([id, p]) => ({
            id,
            label: p.label,
            description: p.description ?? '',
            tier: purposeTier(p),
            output: p.output && p.output !== 'text' ? 'data' : 'text',
            maxChars: p.input?.text?.maxChars ?? DEFAULT_TEXT_CHARS,
            pictures: p.input?.pictures ?? null,
            pdfs: p.input?.pdfs ?? null,
            perKeyPerDay: p.perKeyPerDay ?? null,
            limitKeyLabel: p.limitKeyLabel?.trim() || null,
            timeoutSeconds: p.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
        })),
        presets: Object.entries(AI_PRESETS).map(([id, p]) => ({
            id,
            label: p.label,
            kind: p.kind,
            processesIn: p.processesIn,
            needsWorkspace: p.baseUrl?.includes('{workspace}') === true,
            needsAddress: p.kind === 'openai' && !p.baseUrl,
            reportsCost: p.reportsCost === true,
            models: Object.entries(p.models).map(([model, m]) => ({ model, ...m })),
        })),
        pricesCheckedOn: PRICES_CHECKED_ON,
        defaultVertexLocation: defaultVertexLocation(),
    };
});
