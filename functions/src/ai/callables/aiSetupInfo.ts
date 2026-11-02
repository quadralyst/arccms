/**
 * Admin: what Settings, AI needs from the server (specs/ai-spec.md, AI-D2, AI-D6): the app's
 * purposes as the page shows them (what each takes and gives, its tier and allowance, never
 * the instruction or the test answer, which stay on the server), and the providers Arc
 * offers, with the models it knows, what they read and cost.
 */
import { onCall } from 'firebase-functions/v2/https';
import { requireAdmin } from '../../search/auth.js';
import { connectorFor } from '../connectors/index.js';
import { AI_PRESETS, BEARER, PRICES_CHECKED_ON, presetNeedsKey } from '../presets.js';
import { aiPurposes, DEFAULT_TEXT_CHARS, DEFAULT_TIMEOUT_SECONDS, isArcPurpose, isFileKind, purposeCacheDays, purposeKind, purposeTier, purposeVoiceNames } from '../purposes.js';
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
            // What it makes, and for a file kind where its files go (specs/ai-media-spec.md, AM-D27).
            makes: purposeKind(p),
            allowanceIn: p.allowanceIn ?? 'calls',
            saveTo: isFileKind(purposeKind(p)) ? p.saveTo ?? null : null,
            deleteAfterDays: p.deleteAfterDays ?? null,
            cacheDays: purposeCacheDays(p),
            fallback: p.fallback !== false,
            maxChars: p.input?.text?.maxChars ?? DEFAULT_TEXT_CHARS,
            pictures: p.input?.pictures ?? null,
            pdfs: p.input?.pdfs ?? null,
            perKeyPerDay: p.perKeyPerDay ?? null,
            limitKeyLabel: p.limitKeyLabel?.trim() || null,
            timeoutSeconds: p.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
            // Arc's own purposes, marked so in the page (AM-D18, AM-D20).
            arc: isArcPurpose(id),
            // A speech purpose's named voices with the app's voice ids by provider (AM-D17); Arc's
            // voice sample is played by the voice chosen, so it has none to show.
            voices: purposeKind(p) === 'speech' && !isArcPurpose(id) ? purposeVoiceNames(p).map((name) => ({ name, ids: { ...(p.voices?.[name] ?? {}) } })) : [],
        })),
        presets: Object.entries(AI_PRESETS).map(([id, p]) => ({
            id,
            label: p.label,
            kind: p.kind,
            processesIn: p.processesIn,
            needsWorkspace: p.baseUrl?.includes('{workspace}') === true,
            needsAddress: p.kind === 'openai' && !p.baseUrl,
            reportsCost: p.reportsCost === true,
            needsKey: presetNeedsKey(p),
            keyHeader: (p.auth ?? BEARER).header,
            currency: p.currency ?? 'USD',
            pricesCheckedOn: p.pricesCheckedOn,
            testedLive: p.testedLive !== false,
            docsReadOn: p.docsReadOn ?? null,
            perMinute: p.perMinute ?? null,
            atOnce: p.atOnce ?? null,
            readsBalance: p.balance !== undefined,
            billingUrl: p.billingUrl ?? null,
            // Its connector makes files, and lists voices for speech (AM-D18).
            files: p.files ?? null,
            makesText: connectorFor(p.kind) !== undefined,
            makesSpeech: Object.values(p.models).some((m) => m.makes === 'speech'),
            models: Object.entries(p.models).map(([model, m]) => ({ model, makes: m.makes ?? 'text', unit: m.unit ?? 'tokens', ...m })),
        })),
        pricesCheckedOn: PRICES_CHECKED_ON,
        defaultVertexLocation: defaultVertexLocation(),
    };
});
