/**
 * An app asks a language model (specs/ai-spec.md, docs/app/ai.html).
 *
 * `askAi` is the app kit's way for an app's Cloud Functions to use AI: one of its purposes
 * (functions/src/custom/ai.ts) with text, pictures and PDFs, answered with text or with data
 * checked against the purpose's schema. Settings, AI decides which models answer, in order;
 * the per-key allowance and the monthly budget are checked first; every call leaves a record
 * (records.ts) and adds to the month's totals (usage.ts). In test mode nothing is sent and
 * nothing is spent. A developer's mistake throws; everything else comes back as a reason.
 */
import { isFeatureOn } from '../feature-flags.js';
import { connectorFor } from './connectors/index.js';
import { FALLBACK_FAILURES, type AttemptFailure, type AttemptUsage, type ConnectorResult } from './connectors/types.js';
import { prepareInput, type PreparedPart } from './input.js';
import { readKey } from './keys.js';
import { consumeAllowance, checkBudget } from './limits.js';
import { findPreset } from './presets.js';
import { findPurpose, purposeReads, purposeSchema, purposeTier, DEFAULT_TIMEOUT_SECONDS } from './purposes.js';
import { writeAiCall, type AiCallRecord, type AttemptRecord } from './records.js';
import { answerProblems, emptyAnswer, parseJsonAnswer, type JsonSchema } from './schema.js';
import { modelInfo, purposeSettings, readAiSettings, type AiModelRef, type AiSettings } from './settings.js';
import { addToTotals, noteConnection } from './usage.js';
import { isAiTestFailure, type AiFailureReason, type AiPurpose, type AiTestAnswer, type AiTestInput, type AiUsage, type AskAiInput, type AskAiResult } from './types.js';

const LIMIT_KEY = /^[^/\s]{1,200}$/;
const MAX_UNITS = 1000;
/** Less than this left of the call's time, and no other model is tried. */
const MIN_ATTEMPT_MS = 2_000;

function fail(message: string): never {
    throw new Error(`askAi: ${message}`);
}

interface Checked {
    purposeId: string;
    purpose: AiPurpose;
    limitKey: string | null;
    units: number;
    ref: string | null;
}

function checked(input: AskAiInput): Checked {
    if (typeof input !== 'object' || input === null) fail('pass { purpose, input }.');
    const purposeId = input.purpose;
    if (typeof purposeId !== 'string') fail('purpose must be the id of one of the app\'s purposes.');
    const purpose = findPurpose(purposeId);
    if (!purpose) fail(`no purpose "${purposeId}" in functions/src/custom/ai.ts.`);
    let limitKey: string | null = null;
    if (input.limitKey !== undefined && input.limitKey !== null) {
        if (typeof input.limitKey !== 'string' || !LIMIT_KEY.test(input.limitKey)) fail('limitKey must be text of 1 to 200 characters without / or spaces, such as a business id.');
        limitKey = input.limitKey;
    }
    if (purpose.perKeyPerDay !== undefined && !limitKey) fail(`purpose "${purposeId}" has a per-key allowance, so every call needs a limitKey.`);
    const units = input.units ?? 1;
    if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS) fail(`units must be a whole number from 1 to ${MAX_UNITS}.`);
    let ref: string | null = null;
    if (input.ref !== undefined && input.ref !== null) {
        if (typeof input.ref !== 'string' || input.ref.length > 300) fail('ref must be text of at most 300 characters.');
        ref = input.ref;
    }
    return { purposeId, purpose, limitKey, units, ref };
}

/** The instruction a model gets: the purpose's, and for a model that promises only JSON, the shape to answer in. */
export function instructionFor(purpose: AiPurpose, schema: JsonSchema | null, support: 'strict' | 'json'): string {
    if (!schema || support === 'strict') return purpose.instruction;
    return `${purpose.instruction}\n\nAnswer with JSON only, no other text, in exactly this shape (a JSON schema):\n${JSON.stringify(schema)}`;
}

/** What the test answer stands for, as a model's text would. */
function testResult(answer: AiTestAnswer, purpose: AiPurpose, schema: JsonSchema | null, input: AiTestInput): ConnectorResult | { testFailure: AiFailureReason; wait?: number; detail?: string } {
    let value: unknown = typeof answer === 'function' ? (answer as (i: AiTestInput) => unknown)(input) : answer;
    if (isAiTestFailure(value)) return { testFailure: value.aiTestFailure, wait: value.wait, detail: value.detail ?? 'a test answer' };
    if (value === undefined) value = schema ? emptyAnswer(schema) : `Test answer for ${purpose.label}.`;
    const text = typeof value === 'string' && !schema ? value : JSON.stringify(value);
    return { ok: true, text, usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 } };
}

function testInput(parts: PreparedPart[], c: Checked): AiTestInput {
    return {
        text: parts.flatMap((p) => (p.kind === 'text' ? [p.text] : [])),
        files: parts.flatMap((p) => (p.kind === 'text' ? [] : [{ mimeType: p.mimeType, bytes: p.bytes.length, name: p.name }])),
        limitKey: c.limitKey,
        ref: c.ref,
    };
}

/** The answer's text as the app gets it: text, or data that fits the schema. */
function readAnswer(text: string, schema: JsonSchema | null): { ok: true; data?: unknown; text?: string } | { ok: false; detail: string } {
    if (!schema) return text.trim() ? { ok: true, text } : { ok: false, detail: 'the answer was empty' };
    const data = parseJsonAnswer(text);
    if (data === undefined) return { ok: false, detail: 'the answer was not JSON' };
    const problems = answerProblems(data, schema);
    if (problems.length) return { ok: false, detail: `the answer does not fit the schema: ${problems.join('; ')}` };
    return { ok: true, data };
}

function finalReason(failure: AttemptFailure): AiFailureReason {
    if (failure === 'retired' || failure === 'key-refused') return 'unavailable';
    return failure;
}

function cost(settings: AiSettings, ref: AiModelRef, usage: AttemptUsage): { usd: number; from: AiCallRecord['costFrom'] } {
    if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)) return { usd: usage.costUsd, from: 'provider' };
    const info = modelInfo(settings, ref);
    if (info.priceIn === undefined || info.priceOut === undefined) return { usd: 0, from: 'none' };
    return { usd: (usage.tokensIn * info.priceIn + usage.tokensOut * info.priceOut) / 1_000_000, from: 'price-list' };
}

// ---------------------------------------------------------------- capture (unit tests)

/** A call as captureAiAsks records it. */
export interface CapturedAiAsk {
    purpose: string;
    text: string[];
    files: Array<{ mimeType: string; bytes: number; name: string | null; storagePath: string | null }>;
    limitKey: string | null;
    units: number;
    ref: string | null;
}

let captured: { asks: CapturedAiAsk[]; answers: Record<string, AiTestAnswer> } | null = null;

/**
 * For an app's unit tests: while it runs, askAi checks its input exactly as for real and
 * records each call instead of touching Firestore, Storage or a provider, answering as test
 * mode does (or with `answers[purpose]`). Storage files are recorded by path, not read.
 *
 *   const ai = captureAiAsks({ answers: { 'menu-scan': SAMPLE } });
 *   await runMyFunction();
 *   expect(ai.asks[0].purpose).toBe('menu-scan');
 *   ai.stop();
 */
export function captureAiAsks(options: { answers?: Record<string, AiTestAnswer> } = {}): { asks: CapturedAiAsk[]; stop: () => void } {
    const sink = { asks: [] as CapturedAiAsk[], answers: options.answers ?? {} };
    captured = sink;
    return {
        asks: sink.asks,
        stop: () => {
            if (captured === sink) captured = null;
        },
    };
}

function noUsage(test: boolean, ms = 0): AiUsage {
    return { model: null, connection: null, tokensIn: 0, tokensOut: 0, tokensThinking: 0, costUsd: 0, ms, test };
}

async function askCaptured(c: Checked, input: AskAiInput, sink: NonNullable<typeof captured>): Promise<AskAiResult> {
    const prepared = await prepareInput(c.purposeId, c.purpose, input.input, { readStorage: false });
    const usage = noUsage(true);
    if (!prepared.ok) return { ok: false, reason: prepared.reason, detail: prepared.detail, usage, recordId: null };
    sink.asks.push({
        purpose: c.purposeId,
        text: prepared.parts.flatMap((p) => (p.kind === 'text' ? [p.text] : [])),
        files: prepared.parts.flatMap((p) => (p.kind === 'text' ? [] : [{ mimeType: p.mimeType, bytes: p.bytes.length, name: p.name, storagePath: p.storagePath }])),
        limitKey: c.limitKey,
        units: c.units,
        ref: c.ref,
    });
    const schema = purposeSchema(c.purpose);
    const answer = c.purposeId in sink.answers ? sink.answers[c.purposeId] : c.purpose.testAnswer;
    const result = testResult(answer, c.purpose, schema, testInput(prepared.parts, c));
    if ('testFailure' in result) return { ok: false, reason: result.testFailure, wait: result.wait, detail: result.detail, ...(result.testFailure === 'limit' ? { scope: 'key' as const } : {}), usage, recordId: null };
    if (!result.ok) return { ok: false, reason: 'unreadable', detail: result.detail, usage, recordId: null };
    const read = readAnswer(result.text, schema);
    if (!read.ok) return { ok: false, reason: 'unreadable', detail: read.detail, usage, recordId: null };
    return { ok: true, ...(schema ? { data: read.data } : { text: read.text }), usage, recordId: null };
}

// ---------------------------------------------------------------- askAi

/** Ask a model, as one of the app's purposes says. See docs/app/ai.html. */
export async function askAi(input: AskAiInput): Promise<AskAiResult> {
    const started = Date.now();
    const c = checked(input);
    if (!isFeatureOn('ai')) {
        return { ok: false, reason: 'off', detail: 'the ai feature is off: add it to on in src/custom/features.ts', usage: noUsage(false), recordId: null };
    }
    if (captured) return askCaptured(c, input, captured);

    const settings = await readAiSettings();
    const ps = purposeSettings(settings, c.purposeId);
    const test = settings.mode === 'test';
    const tier = purposeTier(c.purpose);
    const schema = purposeSchema(c.purpose);
    const attempts: AttemptRecord[] = [];
    const usage = { tokensIn: 0, tokensOut: 0, tokensThinking: 0, costUsd: 0 };
    let costFrom: AiCallRecord['costFrom'] = 'none';
    let last: AiModelRef | null = null;
    let inputSize = { chars: 0, files: 0, bytes: 0 };
    let parts: PreparedPart[] = [];
    let allowance: { release: () => Promise<void> } | null = null;

    const finish = async (outcome: { ok: true; data?: unknown; text?: string; answerText: string } | { ok: false; reason: AiFailureReason; detail?: string; wait?: number; scope?: 'key' | 'budget' }): Promise<AskAiResult> => {
        const ms = Date.now() - started;
        if (!outcome.ok && allowance) await allowance.release();
        const record: AiCallRecord = {
            purpose: c.purposeId,
            tier,
            test,
            ref: c.ref,
            limitKey: c.limitKey,
            units: c.units,
            input: inputSize,
            attempts,
            connection: last?.connection ?? null,
            model: last?.model ?? null,
            ...usage,
            costFrom,
            ms,
            outcome: outcome.ok ? 'ok' : outcome.reason,
            ...(outcome.ok ? {} : { scope: outcome.scope, detail: outcome.detail?.slice(0, 500) }),
        };
        const content = ps.keepContent ? { instruction: c.purpose.instruction, parts, answer: outcome.ok ? outcome.answerText : null } : null;
        const recordId = await writeAiCall(record, content);
        await addToTotals(record, new Date(started));
        const resultUsage: AiUsage = { model: record.model, connection: record.connection, ...usage, ms, test };
        if (outcome.ok) return { ok: true, ...(schema ? { data: outcome.data } : { text: outcome.text }), usage: resultUsage, recordId };
        return { ok: false, reason: outcome.reason, ...(outcome.scope ? { scope: outcome.scope } : {}), ...(outcome.wait ? { wait: outcome.wait } : {}), ...(outcome.detail ? { detail: outcome.detail } : {}), usage: resultUsage, recordId };
    };

    if (!ps.enabled) return finish({ ok: false, reason: 'off', detail: `${c.purposeId} is switched off in Settings, AI` });

    const perDay = ps.perKeyPerDay ?? c.purpose.perKeyPerDay ?? null;
    if (perDay !== null && c.limitKey) {
        const use = await consumeAllowance(c.purposeId, c.limitKey, c.units, perDay);
        if (!use.ok) return finish({ ok: false, reason: 'limit', scope: 'key', wait: use.wait, detail: `${c.limitKey} has used its ${perDay} for today` });
        allowance = use;
    }
    if (!test) {
        const budget = await checkBudget(settings);
        if (!budget.ok) return finish({ ok: false, reason: 'limit', scope: 'budget', wait: budget.wait, detail: `the month's budget of ${settings.budget.monthlyUsd} USD is spent` });
    }

    const prepared = await prepareInput(c.purposeId, c.purpose, input.input);
    inputSize = { chars: prepared.chars, files: prepared.files, bytes: prepared.bytes };
    if (!prepared.ok) return finish({ ok: false, reason: prepared.reason, detail: prepared.detail });
    parts = prepared.parts;

    if (test) {
        const result = testResult(c.purpose.testAnswer, c.purpose, schema, testInput(parts, c));
        if ('testFailure' in result) return finish({ ok: false, reason: result.testFailure, wait: result.wait, detail: result.detail, ...(result.testFailure === 'limit' ? { scope: 'key' as const } : {}) });
        if (!result.ok) return finish({ ok: false, reason: 'unreadable', detail: result.detail });
        const read = readAnswer(result.text, schema);
        if (!read.ok) return finish({ ok: false, reason: 'unreadable', detail: `the test answer: ${read.detail}` });
        return finish({ ok: true, data: read.data, text: read.text, answerText: result.text });
    }

    const list = ps.models.length ? ps.models : settings.tiers[tier];
    if (!list.length) return finish({ ok: false, reason: 'off', detail: `no model is set for the ${tier} tier in Settings, AI` });
    const needs = purposeReads(c.purpose).filter((k) => parts.some((p) => (k === 'pictures' ? p.kind === 'picture' : p.kind === 'pdf')));
    const deadline = started + (c.purpose.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    let lastFailure: { failure: AttemptFailure; detail: string; wait?: number } | null = null;

    for (const ref of list) {
        const connection = settings.connections[ref.connection];
        const preset = connection ? findPreset(connection.preset) : undefined;
        const info = modelInfo(settings, ref);
        if (!connection || !preset) continue;
        const missing = needs.filter((k) => !info.reads.includes(k));
        if (missing.length) {
            attempts.push({ connection: ref.connection, model: ref.model, outcome: 'skipped', ms: 0, detail: `reads no ${missing.join(' or ')}` });
            continue;
        }
        const left = deadline - Date.now();
        if (left < MIN_ATTEMPT_MS) {
            lastFailure = { failure: 'timeout', detail: 'no time was left for another model' };
            break;
        }
        last = ref;
        const attemptStarted = Date.now();
        let result: ConnectorResult;
        const key = preset.kind === 'openai' ? await readKey(connection) : { ok: true as const, key: null };
        if (!key.ok) result = { ok: false, failure: 'off', detail: key.detail };
        else {
            result = await connectorFor(preset.kind)({ connection, key: key.key }, {
                model: ref.model,
                instruction: instructionFor(c.purpose, schema, info.schema),
                parts,
                schema,
                schemaSupport: info.schema,
                maxOutputTokens: c.purpose.maxOutputTokens,
                temperature: c.purpose.temperature,
                timeoutMs: left,
            });
        }
        const ms = Date.now() - attemptStarted;
        if (result.usage) {
            usage.tokensIn += result.usage.tokensIn;
            usage.tokensOut += result.usage.tokensOut;
            usage.tokensThinking += result.usage.tokensThinking;
            const spent = cost(settings, ref, result.usage);
            usage.costUsd += spent.usd;
            if (spent.from !== 'none') costFrom = costFrom === 'provider' || spent.from === 'provider' ? 'provider' : 'price-list';
        }
        if (result.ok) {
            attempts.push({ connection: ref.connection, model: ref.model, outcome: 'ok', ms });
            await noteConnection(settings, ref.connection, null);
            const read = readAnswer(result.text, schema);
            if (!read.ok) return finish({ ok: false, reason: 'unreadable', detail: read.detail });
            return finish({ ok: true, data: read.data, text: read.text, answerText: result.text });
        }
        attempts.push({ connection: ref.connection, model: ref.model, outcome: result.failure, ms, detail: result.detail.slice(0, 300) });
        if (result.failure === 'key-refused' || result.failure === 'retired' || result.failure === 'off') await noteConnection(settings, ref.connection, result.detail);
        lastFailure = { failure: result.failure, detail: result.detail, wait: result.wait };
        if (!FALLBACK_FAILURES.includes(result.failure)) break;
    }

    if (!lastFailure) {
        const detail = attempts.length ? `no model in the list reads ${needs.join(' or ')}` : `no model is set for the ${tier} tier in Settings, AI`;
        return finish({ ok: false, reason: 'off', detail });
    }
    return finish({ ok: false, reason: finalReason(lastFailure.failure), detail: lastFailure.detail, wait: lastFailure.wait });
}
