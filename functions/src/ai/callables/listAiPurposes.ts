/**
 * Admin: the app's AI purposes as Settings, AI shows them (specs/ai-spec.md, AI-D2): what
 * each takes and gives, its tier and allowance. Never the instruction or the test answer,
 * which stay on the server.
 */
import { onCall } from 'firebase-functions/v2/https';
import { requireAdmin } from '../../search/auth.js';
import { aiPurposes, DEFAULT_TEXT_CHARS, DEFAULT_TIMEOUT_SECONDS, purposeTier } from '../purposes.js';

export const listAiPurposes = onCall(async (request) => {
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
            timeoutSeconds: p.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
        })),
    };
});
