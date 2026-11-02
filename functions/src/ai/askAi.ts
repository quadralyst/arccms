/**
 * An app asks AI (specs/ai-spec.md, specs/ai-media-spec.md, docs/app/ai.html).
 *
 * `askAi` is the app kit's way for an app's Cloud Functions to use AI: one of its purposes
 * (functions/src/custom/ai.ts), answered with text, with data checked against the purpose's
 * schema, or with files saved to Storage (pictures, speech, other audio, video). Settings,
 * AI decides which models answer, in order; Arc's own cache, the per-key allowance and the
 * monthly budget are checked first; every call leaves a record (records.ts) and adds to the
 * month's totals (usage.ts). In test mode nothing is sent and nothing is spent: a file kind
 * gets a small stand-in file. A developer's mistake throws; everything else comes back as a
 * reason.
 */
import { isFeatureOn } from '../feature-flags.js';
import { findCached, cacheHash, storeCached, type CacheEntry } from './cache.js';
import { connectorFor, fileConnectorFor } from './connectors/index.js';
import { FALLBACK_FAILURES, type AttemptFailure, type AttemptUsage, type ConnectorResult, type FileResult, type JobStarted, type MadeFile } from './connectors/types.js';
import { attemptCost, type CostFrom } from './cost.js';
import { copyFile, filePaths, readBucketFile, saveFiles } from './files.js';
import { prepareInput, type PreparedPart } from './input.js';
import { readKey } from './keys.js';
import { consumeAllowance, checkBudget } from './limits.js';
import { waitForPlace } from './pacing.js';
import { storagePathProblem } from './paths.js';
import { findPreset, presetNeedsKey, type AiSpeechAbilities } from './presets.js';
import { fileSettingsProblems, findPurpose, isFileKind, MAX_PICTURES, purposeAvatarNames, purposeCacheDays, purposeKind, purposeReads, purposeSchema, purposeTier, purposeVoiceNames, DEFAULT_TIMEOUT_SECONDS } from './purposes.js';
import { newAiCallId, writeAiCall, type AiCallRecord, type AttemptRecord } from './records.js';
import { answerProblems, emptyAnswer, parseJsonAnswer, type JsonSchema } from './schema.js';
import { connectionLimits, modelInfo, pacingKey, purposeSettings, readAiSettings, type AiModelRef } from './settings.js';
import { fittedImage, imageSkip, picturePrice } from './images.js';
import { checkedStoragePath } from './input.js';
import { createJob, jobMinutes, markJobLost } from './jobs.js';
import { audioSkip, DEFAULT_AUDIO_SECONDS, fittedAudio, MUSIC_MARGIN_SECONDS } from './audios.js';
import { DEFAULT_VIDEO_SECONDS, fittedVideo, videoSkip } from './videos.js';
import { standInFiles } from './standins.js';
import { voiceIdFor } from './voices.js';
import { addToTotals, alertOutOfCredit, noteConnection } from './usage.js';
import { AI_ASPECTS, isAiTestFailure, type AiFailureReason, type AiFile, type AiFileKind, type AiImageSettings, type AiKind, type AiPurpose, type AiVideoSettings, type AiTestAnswer, type AiTestInput, type AiUnit, type AiUsage, type AskAiInput, type AskAiResult } from './types.js';

const LIMIT_KEY = /^[^/\s]{1,200}$/;
const MAX_UNITS = 1000;
const MAX_PER_DAY = 1_000_000;
/** Less than this left of the call's time, and no other model is tried. */
const MIN_ATTEMPT_MS = 2_000;
/** The longest a provider's "try again in" is waited for on the same model (AM-D15). */
const MAX_RETRY_WAIT_S = 20;
/** The largest audio file a presenter speaks to (HeyGen takes 50 MB). */
const MAX_SPEECH_FILE_BYTES = 50 * 1024 * 1024;

function fail(message: string): never {
    throw new Error(`askAi: ${message}`);
}

/** A file kind's settings for one call: the purpose's, with the call's over them (AM-D19). */
export interface CallSettings {
    image?: AiImageSettings;
    speech?: AiPurpose['speech'];
    audio?: AiPurpose['audio'];
    video?: AiPurpose['video'];
}

interface Checked {
    purposeId: string;
    purpose: AiPurpose;
    kind: AiKind;
    settings: CallSettings;
    /** Speech: the voice asked for, by its name in the purpose (AM-D17). */
    voice: string | null;
    /** Presenter video: the avatar asked for, by its name in the purpose (AM-D33). */
    avatar: string | null;
    /** Presenter video: the audio file the avatar speaks to, in place of the text. */
    speechFile: string | null;
    /** A long job: who may read it from a browser (AM-D13). */
    readers: string[];
    saveAs: string | null;
    limitKey: string | null;
    units: number;
    /** The call's own allowance for its key, or null. */
    perDay: number | null;
    ref: string | null;
}

/** What Arc's own callables add to a call, never an app (AM-D18). */
export interface ArcAskOptions {
    /** Only this model answers, in place of the purpose's list. */
    only?: AiModelRef;
    /** Speech: this provider voice id, in place of the purpose's named voice. */
    voiceId?: string;
    /** Save the files in `ai-files/`, never the purpose's `saveTo` (the Media Manager, AM-D24). */
    ignoreSaveTo?: boolean;
}

function checked(input: AskAiInput, arc: boolean): Checked {
    if (typeof input !== 'object' || input === null) fail('pass { purpose, input }.');
    const purposeId = input.purpose;
    if (typeof purposeId !== 'string') fail('purpose must be the id of one of the app\'s purposes.');
    const purpose = findPurpose(purposeId, { arc });
    if (!purpose) fail(`no purpose "${purposeId}" in functions/src/custom/ai.ts.`);
    let limitKey: string | null = null;
    if (input.limitKey !== undefined && input.limitKey !== null) {
        if (typeof input.limitKey !== 'string' || !LIMIT_KEY.test(input.limitKey)) fail('limitKey must be text of 1 to 200 characters without / or spaces, such as a business id.');
        limitKey = input.limitKey;
    }
    if (purpose.perKeyPerDay !== undefined && !limitKey) fail(`purpose "${purposeId}" has a per-key allowance, so every call needs a limitKey.`);
    const units = input.units ?? 1;
    if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS) fail(`units must be a whole number from 1 to ${MAX_UNITS}.`);
    let perDay: number | null = null;
    if (input.perDay !== undefined && input.perDay !== null) {
        if (!Number.isInteger(input.perDay) || input.perDay < 0 || input.perDay > MAX_PER_DAY) fail(`perDay must be a whole number from 0 to ${MAX_PER_DAY}.`);
        if (!limitKey) fail('perDay is the allowance of one key, so pass its limitKey too.');
        perDay = input.perDay;
    }
    let ref: string | null = null;
    if (input.ref !== undefined && input.ref !== null) {
        if (typeof input.ref !== 'string' || input.ref.length > 300) fail('ref must be text of at most 300 characters.');
        ref = input.ref;
    }
    const kind = purposeKind(purpose);
    const settings = callSettings(purposeId, purpose, kind, input);
    let voice: string | null = null;
    if (input.voice !== undefined && input.voice !== null) {
        if (kind !== 'speech') fail(`voice is for a purpose that makes speech; ${purposeId} makes ${kind}.`);
        if (typeof input.voice !== 'string' || !purposeVoiceNames(purpose).includes(input.voice)) fail(`voice must be one of ${purposeId}'s voices: ${purposeVoiceNames(purpose).join(', ')}.`);
        voice = input.voice;
    } else if (kind === 'speech') voice = purposeVoiceNames(purpose)[0];
    const presenter = kind === 'video' && purpose.video?.presenter === true;
    let avatar: string | null = null;
    if (input.avatar !== undefined && input.avatar !== null) {
        if (!presenter) fail(`avatar is for a presenter video purpose (video: { presenter: true }); ${purposeId} is not one.`);
        if (typeof input.avatar !== 'string' || !purposeAvatarNames(purpose).includes(input.avatar)) fail(`avatar must be one of ${purposeId}'s avatars: ${purposeAvatarNames(purpose).join(', ')}.`);
        avatar = input.avatar;
    } else if (presenter) avatar = purposeAvatarNames(purpose)[0];
    let speechFile: string | null = null;
    if (input.speechFile !== undefined && input.speechFile !== null) {
        if (!presenter) fail(`speechFile is for a presenter video purpose; ${purposeId} is not one.`);
        speechFile = checkedStoragePath((input.speechFile as { storagePath?: unknown }).storagePath);
    }
    let readers: string[] = [];
    if (input.readers !== undefined && input.readers !== null) {
        if (kind !== 'video') fail(`readers are for a long job, such as a video; ${purposeId} makes ${kind}.`);
        if (!Array.isArray(input.readers) || input.readers.length > 10 || input.readers.some((r) => typeof r !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r))) fail('readers must be up to 10 arccms_uid values.');
        readers = [...new Set(input.readers)];
    }
    let saveAs: string | null = null;
    if (input.saveAs !== undefined && input.saveAs !== null) {
        if (!isFileKind(kind)) fail(`saveAs is for a purpose that makes files; ${purposeId} makes ${kind}.`);
        if (!purpose.saveTo) fail(`saveAs needs the purpose's saveTo folder; add saveTo to ${purposeId} in functions/src/custom/ai.ts.`);
        const problem = storagePathProblem(input.saveAs, 'saveAs');
        if (problem) fail(`${problem}.`);
        const folder = purpose.saveTo.replace(/\/+$/, '');
        if (!input.saveAs.startsWith(`${folder}/`)) fail(`saveAs "${input.saveAs}" must be inside ${purposeId}'s folder, ${folder}/.`);
        saveAs = input.saveAs;
    }
    return { purposeId, purpose, kind, settings, voice, avatar, speechFile, readers, saveAs, limitKey, units, perDay, ref };
}

/** The call's settings for its kind over the purpose's; a setting for another kind is a mistake. */
function callSettings(purposeId: string, purpose: AiPurpose, kind: AiKind, input: AskAiInput): CallSettings {
    for (const k of ['image', 'speech', 'audio', 'video'] as const) {
        if (input[k] !== undefined && k !== kind) fail(`${k} settings are for a purpose that makes ${k}; ${purposeId} makes ${kind}.`);
        if (input[k] !== undefined && (typeof input[k] !== 'object' || input[k] === null)) fail(`${k} must be an object of settings.`);
    }
    if (isFileKind(kind) && input[kind] !== undefined) {
        // The call's own settings get the same checks as the purpose's.
        const problem = fileSettingsProblems('the call', { label: purposeId, [kind]: input[kind] } as AiPurpose, kind)[0];
        if (problem) fail(`${problem}.`);
    }
    if (kind === 'image') {
        const image = { ...purpose.image, ...input.image };
        if (image.count !== undefined && (!Number.isInteger(image.count) || image.count < 1 || image.count > MAX_PICTURES)) fail(`image.count must be a whole number from 1 to ${MAX_PICTURES}.`);
        if (image.aspect !== undefined && !AI_ASPECTS.includes(image.aspect)) fail(`image.aspect must be one of ${AI_ASPECTS.join(', ')}.`);
        if (image.seed !== undefined && !Number.isInteger(image.seed)) fail('image.seed must be a whole number.');
        if (image.negativePrompt !== undefined && (typeof image.negativePrompt !== 'string' || image.negativePrompt.length > 1000)) fail('image.negativePrompt must be text of at most 1,000 characters.');
        return { image };
    }
    if (kind === 'speech') {
        const speech = { ...purpose.speech, ...input.speech };
        if (speech.speed !== undefined && (typeof speech.speed !== 'number' || speech.speed < 0.5 || speech.speed > 2)) fail('speech.speed must be from 0.5 to 2.');
        return { speech };
    }
    if (kind === 'audio') {
        // Whether it is a sound or music is the purpose's alone; left out, a sound effect.
        const audio = { ...purpose.audio, ...input.audio, type: purpose.audio?.type ?? 'sound' };
        if (audio.seconds !== undefined && (typeof audio.seconds !== 'number' || audio.seconds < 0.5 || audio.seconds > 600)) fail('audio.seconds must be from 0.5 to 600.');
        return { audio };
    }
    if (kind === 'video') {
        // Whether a video is a presenter's is the purpose's alone.
        const { presenter: _asked, ...rest } = { ...purpose.video, ...input.video } as AiVideoSettings;
        const video: AiVideoSettings = purpose.video?.presenter ? { ...rest, presenter: true } : rest;
        if (video.seconds !== undefined && (typeof video.seconds !== 'number' || video.seconds < 1 || video.seconds > 60)) fail('video.seconds must be from 1 to 60.');
        return { video };
    }
    return {};
}

/** The amount a call's allowance counts (AM-D23): its units, or what it asks to be made. */
function allowanceAmount(c: Checked, chars: number): number {
    switch (c.purpose.allowanceIn ?? 'calls') {
        case 'pictures': return c.settings.image?.count ?? 1;
        case 'characters': return Math.max(1, chars);
        case 'seconds': return Math.max(1, Math.ceil(c.settings.audio ? c.settings.audio.seconds ?? DEFAULT_AUDIO_SECONDS : c.settings.video?.seconds ?? DEFAULT_VIDEO_SECONDS));
        default: return c.units;
    }
}

/** The instruction a model gets: the purpose's, and for a model that promises only JSON, the shape to answer in. */
export function instructionFor(purpose: AiPurpose, schema: JsonSchema | null, support: 'strict' | 'json'): string {
    const instruction = purpose.instruction ?? '';
    if (!schema || support === 'strict') return instruction;
    return `${instruction}\n\nAnswer with JSON only, no other text, in exactly this shape (a JSON schema):\n${JSON.stringify(schema)}`;
}

/**
 * A file kind's prompt: the call's text, then the purpose's instruction (its house style),
 * AM-D24. Speech is the text alone, since every word of it is read aloud.
 */
export function filePrompt(purpose: AiPurpose, parts: PreparedPart[]): string {
    const text = parts.flatMap((p) => (p.kind === 'text' ? [p.text] : [])).join('\n').trim();
    if (purposeKind(purpose) === 'speech') return text;
    const style = purpose.instruction?.trim();
    return style ? (text ? `${text}\n\n${style}` : style) : text;
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

// ---------------------------------------------------------------- capture (unit tests)

/** A call as captureAiAsks records it. */
export interface CapturedAiAsk {
    purpose: string;
    text: string[];
    files: Array<{ mimeType: string; bytes: number; name: string | null; storagePath: string | null }>;
    limitKey: string | null;
    units: number;
    perDay: number | null;
    ref: string | null;
    /** Speech: the voice asked for, by its name in the purpose. */
    voice: string | null;
    /** Presenter video: the avatar asked for, by its name in the purpose. */
    avatar?: string | null;
}

let captured: { asks: CapturedAiAsk[]; answers: Record<string, AiTestAnswer> } | null = null;

/** A file kind's test answer: only a failure means anything; anything else gets the stand-ins. */
function testFileFailure(answer: AiTestAnswer, input: AiTestInput): { testFailure: AiFailureReason; wait?: number; detail?: string } | null {
    const value: unknown = typeof answer === 'function' ? (answer as (i: AiTestInput) => unknown)(input) : answer;
    return isAiTestFailure(value) ? { testFailure: value.aiTestFailure, wait: value.wait, detail: value.detail ?? 'a test answer' } : null;
}

function fileOf(path: string, f: MadeFile): AiFile {
    const file: AiFile = { path, mimeType: f.mimeType, bytes: f.bytes.length };
    if (f.width) file.width = f.width;
    if (f.height) file.height = f.height;
    if (f.seconds) file.seconds = f.seconds;
    return file;
}

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

function noUsage(test: boolean, kind: AiKind = 'text', ms = 0): AiUsage {
    return { model: null, connection: null, tokensIn: 0, tokensOut: 0, tokensThinking: 0, tokensCached: 0, tokensCacheWrite: 0, kind, amount: 0, unit: 'tokens', costUsd: 0, ms, test };
}

/** The unit a kind is usually billed in, until a model says otherwise. */
function kindUnit(kind: AiKind): AiUnit {
    if (kind === 'image') return 'pictures';
    if (kind === 'speech') return 'characters';
    if (kind === 'audio' || kind === 'video') return 'seconds';
    return 'tokens';
}

/** The UTC month a file's folder is named after. */
function fileMonth(at: number): string {
    return new Date(at).toISOString().slice(0, 7);
}

async function askCaptured(c: Checked, input: AskAiInput, sink: NonNullable<typeof captured>): Promise<AskAiResult> {
    const prepared = await prepareInput(c.purposeId, c.purpose, input.input, { readStorage: false });
    const usage = noUsage(true, c.kind);
    if (!prepared.ok) return { ok: false, reason: prepared.reason, detail: prepared.detail, usage, recordId: null };
    sink.asks.push({
        purpose: c.purposeId,
        text: prepared.parts.flatMap((p) => (p.kind === 'text' ? [p.text] : [])),
        files: prepared.parts.flatMap((p) => (p.kind === 'text' ? [] : [{ mimeType: p.mimeType, bytes: p.bytes.length, name: p.name, storagePath: p.storagePath }])),
        limitKey: c.limitKey,
        units: c.units,
        perDay: c.perDay,
        ref: c.ref,
        voice: c.voice,
        ...(c.avatar ? { avatar: c.avatar } : {}),
    });
    const answer = c.purposeId in sink.answers ? sink.answers[c.purposeId] : c.purpose.testAnswer;
    if (isFileKind(c.kind)) {
        // Nothing is written: the stand-ins' paths say where a test call would have put them.
        const failure = testFileFailure(answer, testInput(prepared.parts, c));
        if (failure) return { ok: false, reason: failure.testFailure, wait: failure.wait, detail: failure.detail, ...(failure.testFailure === 'limit' ? { scope: 'key' as const } : {}), usage, recordId: null };
        // A video is a long job: a capture answers pending, as test mode does until its check.
        if (c.kind === 'video') return { ok: 'pending', jobId: 'captured', usage, recordId: null };
        const made = standInFiles(c.kind, { image: c.settings.image, audioSeconds: c.settings.audio?.seconds, chars: prepared.chars });
        const paths = filePaths({ recordId: 'captured', purpose: c.purposeId, month: fileMonth(Date.now()), test: true, files: made });
        return { ok: true, files: made.map((f, i) => fileOf(paths[i], f)), usage, recordId: null };
    }
    const schema = purposeSchema(c.purpose);
    const result = testResult(answer, c.purpose, schema, testInput(prepared.parts, c));
    if ('testFailure' in result) return { ok: false, reason: result.testFailure, wait: result.wait, detail: result.detail, ...(result.testFailure === 'limit' ? { scope: 'key' as const } : {}), usage, recordId: null };
    if (!result.ok) return { ok: false, reason: 'unreadable', detail: result.detail, usage, recordId: null };
    const read = readAnswer(result.text, schema);
    if (!read.ok) return { ok: false, reason: 'unreadable', detail: read.detail, usage, recordId: null };
    return { ok: true, ...(schema ? { data: read.data } : { text: read.text }), usage, recordId: null };
}

// ---------------------------------------------------------------- askAi

/** What the attempts so far billed, added up. */
interface Spent {
    tokensIn: number;
    tokensOut: number;
    tokensThinking: number;
    tokensCached: number;
    tokensCacheWrite: number;
    costUsd: number;
    amount: number;
    unit: AiUnit;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ask AI, as one of the app's purposes says. See docs/app/ai.html. */
export async function askAi(input: AskAiInput): Promise<AskAiResult> {
    return ask(input, null);
}

/** Ask AI for one of Arc's own purposes, such as a voice sample (not in the app kit). */
export async function askAiForArc(input: AskAiInput, options: ArcAskOptions): Promise<AskAiResult> {
    return ask(input, options);
}

async function ask(input: AskAiInput, arc: ArcAskOptions | null): Promise<AskAiResult> {
    const started = Date.now();
    const c = checked(input, arc !== null);
    if (!isFeatureOn('ai')) {
        return { ok: false, reason: 'off', detail: 'the ai feature is off: add it to on in src/custom/features.ts', usage: noUsage(false, c.kind), recordId: null };
    }
    if (captured) return askCaptured(c, input, captured);

    const settings = await readAiSettings();
    const ps = purposeSettings(settings, c.purposeId);
    const test = settings.mode === 'test';
    const tier = purposeTier(c.purpose);
    const schema = purposeSchema(c.purpose);
    const fileKind: AiFileKind | null = isFileKind(c.kind) ? c.kind : null;
    const recordId = newAiCallId();
    const attempts: AttemptRecord[] = [];
    const spent: Spent = { tokensIn: 0, tokensOut: 0, tokensThinking: 0, tokensCached: 0, tokensCacheWrite: 0, costUsd: 0, amount: 0, unit: kindUnit(c.kind) };
    let costFrom: CostFrom = 'none';
    let last: AiModelRef | null = null;
    /** Speech: the provider voice id of the model that answered, or the last one tried. */
    let lastVoiceId: string | null = null;
    /** Pictures: the settings the model that answered, or the last one tried, was asked with (AM-D19). */
    let lastImage: AiImageSettings | null = null;
    /** Where this call's files go: the purpose's folder, unless Arc's caller keeps them in ai-files/. */
    const saveTo = arc?.ignoreSaveTo ? undefined : c.purpose.saveTo;
    let inputSize = { chars: 0, files: 0, bytes: 0 };
    let parts: PreparedPart[] = [];
    let allowance: { release: (units?: number) => Promise<void>; path: string; units: number } | null = null;
    let spentBefore: number | null = null;

    type Outcome =
        | { ok: true; data?: unknown; text?: string; answerText: string | null; files?: AiFile[]; cachedFrom?: string | null }
        | { ok: 'pending'; answerText?: null }
        | { ok: false; reason: AiFailureReason; detail?: string; wait?: number; scope?: 'key' | 'budget'; answerText?: string };

    const finish = async (outcome: Outcome): Promise<AskAiResult> => {
        const ms = Date.now() - started;
        // A failure gives its units back only when nothing was billed: an answer that was
        // blocked or did not fit was paid for, so it counts, or one key could spend the
        // month's budget without ever reaching its allowance.
        // A timed-out request was most likely still answered, and billed, by the provider.
        const maybeBilled = spent.tokensIn + spent.tokensOut > 0 || spent.amount > 0 || attempts.some((a) => a.outcome === 'timeout');
        if (!outcome.ok && allowance && !maybeBilled) await allowance.release();
        const pending = outcome.ok === 'pending';
        const cached = outcome.ok === true && outcome.cachedFrom !== undefined;
        const record: AiCallRecord = {
            purpose: c.purposeId,
            kind: c.kind,
            tier,
            test,
            ref: c.ref,
            limitKey: c.limitKey,
            units: c.units,
            input: inputSize,
            attempts,
            connection: last?.connection ?? null,
            model: last?.model ?? null,
            ...spent,
            costFrom,
            ms,
            outcome: pending ? 'pending' : outcome.ok ? 'ok' : outcome.reason,
            ...(outcome.ok ? {} : { scope: outcome.scope, detail: outcome.detail?.slice(0, 500) }),
            ...(outcome.ok === true && outcome.files ? { files: outcome.files, filePaths: outcome.files.map((f) => f.path) } : {}),
            ...(cached ? { cached: true, cachedFrom: outcome.ok === true ? outcome.cachedFrom ?? null : null } : {}),
            ...(pending ? { jobId: recordId } : {}),
            ...(c.avatar ? { avatar: c.avatar } : {}),
            ...(c.kind === 'speech' ? { voice: c.voice, voiceId: lastVoiceId } : {}),
            ...(c.kind === 'image' && lastImage ? { image: lastImage } : {}),
        };
        const content = ps.keepContent ? { instruction: c.purpose.instruction ?? '', parts, answer: outcome.answerText ?? null } : null;
        // A job is added to the month's totals when it ends, with its cost (AM-D14).
        const [writtenId] = await Promise.all([
            writeAiCall(record, content, new Date(started), recordId),
            pending ? Promise.resolve() : addToTotals(record, new Date(started), spentBefore === null ? undefined : { spentBefore, monthlyUsd: settings.budget.monthlyUsd }),
        ]);
        const { tokensIn, tokensOut, tokensThinking, tokensCached, tokensCacheWrite, costUsd, amount, unit } = spent;
        const resultUsage: AiUsage = { model: record.model, connection: record.connection, tokensIn, tokensOut, tokensThinking, tokensCached, tokensCacheWrite, kind: c.kind, amount, unit, costUsd, ms, test };
        if (outcome.ok === 'pending') return { ok: 'pending', jobId: recordId, usage: resultUsage, recordId: writtenId };
        if (outcome.ok) {
            return {
                ok: true,
                ...(fileKind ? { files: (outcome as { files?: AiFile[] }).files ?? [] } : schema ? { data: (outcome as { data?: unknown }).data } : { text: (outcome as { text?: string }).text }),
                ...(cached ? { cached: true } : {}),
                ...(c.kind === 'image' && record.image ? { image: record.image } : {}),
                usage: resultUsage,
                recordId: writtenId,
            };
        }
        return { ok: false, reason: outcome.reason, ...(outcome.scope ? { scope: outcome.scope } : {}), ...(outcome.wait ? { wait: outcome.wait } : {}), ...(outcome.detail ? { detail: outcome.detail } : {}), usage: resultUsage, recordId: writtenId };
    };

    if (!ps.enabled) return finish({ ok: false, reason: 'off', detail: `${c.purposeId} is switched off in Settings, AI` });

    const prepared = await prepareInput(c.purposeId, c.purpose, input.input);
    inputSize = { chars: prepared.chars, files: prepared.files, bytes: prepared.bytes };
    if (!prepared.ok) return finish({ ok: false, reason: prepared.reason, detail: prepared.detail });
    parts = prepared.parts;
    // A presenter speaking to an audio file needs no text; everything else does.
    let speechFile: { bytes: Buffer; mimeType: string } | undefined;
    if (c.speechFile) {
        const read = await readBucketFile(c.speechFile, MAX_SPEECH_FILE_BYTES).catch(() => null);
        if (!read) return finish({ ok: false, reason: 'unreadable', detail: `speechFile ${c.speechFile} is not in the bucket` });
        if ('tooLarge' in read) return finish({ ok: false, reason: 'too-large', detail: `speechFile is ${Math.round(read.tooLarge / 1048576)} MB; at most 50 MB` });
        if (!/^audio\/(mpeg|mp3|wav|x-wav|wave)$/.test(read.contentType)) return finish({ ok: false, reason: 'unreadable', detail: `speechFile must be an MP3 or WAV file, not ${read.contentType}` });
        speechFile = { bytes: read.bytes, mimeType: read.contentType };
    }
    if (fileKind && !filePrompt(c.purpose, parts) && !speechFile) return finish({ ok: false, reason: 'unreadable', detail: 'there is no text to make anything of: pass a prompt' });

    // The models that may answer: the purpose's own list, else the tier's (text and data) or
    // the kind's (files), each one that makes this kind.
    const fullList = arc?.only ? [arc.only] : ps.models.length ? ps.models : fileKind ? settings.lists[fileKind] : settings.tiers[tier];
    const wanted = fileKind ?? 'text';
    const makesWanted = fullList.filter((ref) => modelInfo(settings, ref).makes === wanted || (wanted === 'text' && modelInfo(settings, ref).makes === 'data'));
    // With fallback off, only the first model is the purpose's: no other ever answers, or
    // answers from the cache, even when the first one is skipped (AM-D4).
    const list = c.purpose.fallback === false ? makesWanted.slice(0, 1) : makesWanted;
    const instruction = fileKind ? filePrompt(c.purpose, []) : (c.purpose.instruction ?? '');
    /** Speech: the voice id a model's provider uses for the call's voice, or null. */
    const voiceOf = (ref: AiModelRef): string | null => {
        if (c.kind !== 'speech') return null;
        if (arc?.voiceId) return arc.voiceId;
        const preset = settings.connections[ref.connection]?.preset ?? '';
        return voiceIdFor(c.voice ?? '', preset, c.purpose.voices, ps.voices);
    };

    /** Presenter video: the avatar id a model's provider uses for the call's avatar, or null. */
    const avatarOf = (ref: AiModelRef): string | null => {
        if (!c.avatar) return null;
        const preset = settings.connections[ref.connection]?.preset ?? '';
        return voiceIdFor(c.avatar, preset, c.purpose.avatars, ps.avatars);
    };
    /** Starts a long job for this call and answers pending (AM-D12). */
    const startJob = async (job: { connection: string | null; model: string | null; operation: string | null; video: AiVideoSettings | null }): Promise<AskAiResult> => {
        // The record first, so a check that ends the job at once finds it, and never sees it overwritten.
        const answer = await finish({ ok: 'pending' });
        try {
            await createJob(recordId, {
                purpose: c.purposeId, kind: c.kind, recordId, ref: c.ref, limitKey: c.limitKey, readers: c.readers, test,
                connection: job.connection, model: job.model, operation: job.operation, video: job.video,
                saveTo: (test ? null : saveTo) ?? null, saveAs: test || !saveTo ? null : c.saveAs,
                allowance: allowance ? { path: allowance.path, units: allowance.units } : null,
                startedAt: new Date(started), timeoutAt: new Date(started + jobMinutes(c.purpose) * 60_000),
            });
        } catch (err) {
            // Started at the provider but not kept: the record says so, and the call fails.
            const detail = `the job was started but could not be kept: ${String((err as Error).message ?? err).slice(0, 160)}`;
            console.error(`askAi: the job of a ${c.purposeId} call was not kept`, err);
            await markJobLost(recordId, detail).catch(() => undefined);
            return { ok: false, reason: 'unavailable', detail, usage: answer.usage, recordId: answer.recordId };
        }
        return answer;
    };

    // Arc's own cache, before anything is counted: a hit counts against nothing (AM-D16).
    const cacheDays = fileKind && !test && ps.cache !== false ? purposeCacheDays(c.purpose) : 0;
    // The voice is part of the key: the same words in another voice are another file.
    const hashes = cacheDays ? list.flatMap((ref) => {
        const voice = voiceOf(ref);
        if (c.kind === 'speech' && !voice) return [];
        return [{ ref, hash: cacheHash(c.purposeId, ref, voice ? { ...c.settings, voice } : c.settings, instruction, parts) }];
    }) : [];
    if (cacheDays) {
        const hit = await findCached(hashes).catch((err: unknown) => (console.error('askAi: the cache could not be read', err), null));
        // A hit whose files cannot be copied is a miss: the call goes on as if there were none.
        const files = hit ? await hitFiles(hit).catch((err: unknown) => (console.error('askAi: a cached file could not be used', err), null)) : null;
        if (hit && files) {
            last = { connection: hit.connection, model: hit.model };
            lastVoiceId = voiceOf(last);
            attempts.push({ connection: hit.connection, model: hit.model, outcome: 'cached', ms: 0 });
            return finish({ ok: true, answerText: null, files, cachedFrom: hit.recordId });
        }
    }

    // The call's own number for its key comes first, such as from the key's plan. Else the
    // admin's number replaces the app's; a purpose without one in the code has no allowance,
    // since its calls carry no key (Settings, AI offers the field only with one).
    const perDay = c.perDay ?? (c.purpose.perKeyPerDay === undefined ? null : ps.perKeyPerDay ?? c.purpose.perKeyPerDay);
    if (perDay !== null && c.limitKey) {
        const amount = allowanceAmount(c, prepared.chars);
        const use = await consumeAllowance(c.purposeId, c.limitKey, amount, perDay);
        if (!use.ok) return finish({ ok: false, reason: 'limit', scope: 'key', wait: use.wait, detail: perDay === 0 ? `${c.limitKey} has no allowance today` : `${c.limitKey} has used its ${perDay} for today` });
        allowance = use;
    }
    try {
        return await answer();
    } catch (err) {
        // A mistake thrown after the units were counted must not keep them.
        await allowance?.release();
        throw err;
    }

    /** A cache hit's files, copied from the cache to where this call wants them, as a fresh answer would be. */
    async function hitFiles(hit: CacheEntry): Promise<AiFile[]> {
        const paths = filePaths({ recordId, purpose: c.purposeId, month: fileMonth(started), test: false, saveTo, saveAs: saveTo ? c.saveAs ?? undefined : undefined, files: hit.files });
        await Promise.all(hit.paths.map((p, i) => copyFile(p, paths[i])));
        return hit.files.map((f, i) => ({ ...f, path: paths[i] }));
    }

    async function answer(): Promise<AskAiResult> {
        if (!test) {
            const budget = await checkBudget(settings);
            if (!budget.ok) return finish({ ok: false, reason: 'limit', scope: 'budget', wait: budget.wait, detail: `the month's budget of ${settings.budget.monthlyUsd} USD is spent` });
            spentBefore = budget.spent;
        }

        if (test) {
            if (fileKind) {
                const failure = testFileFailure(c.purpose.testAnswer, testInput(parts, c));
                if (failure) return finish({ ok: false, reason: failure.testFailure, wait: failure.wait, detail: failure.detail, ...(failure.testFailure === 'limit' ? { scope: 'key' as const } : {}) });
                // A video is a job in test mode too: the next background check finishes it (AM-D11).
                if (fileKind === 'video') return startJob({ connection: null, model: null, operation: null, video: c.settings.video ?? null });
                const made = standInFiles(fileKind, { image: c.settings.image, audioSeconds: c.settings.audio?.seconds, chars: inputSize.chars });
                const paths = filePaths({ recordId, purpose: c.purposeId, month: fileMonth(started), test: true, files: made });
                try {
                    const files = await saveFiles(paths, made, { recordId, purpose: c.purposeId, test: true });
                    return finish({ ok: true, answerText: null, files });
                } catch (err) {
                    return finish({ ok: false, reason: 'unavailable', detail: `the test file could not be saved: ${String((err as Error).message ?? err).slice(0, 200)}` });
                }
            }
            const result = testResult(c.purpose.testAnswer, c.purpose, schema, testInput(parts, c));
            if ('testFailure' in result) return finish({ ok: false, reason: result.testFailure, wait: result.wait, detail: result.detail, ...(result.testFailure === 'limit' ? { scope: 'key' as const } : {}) });
            if (!result.ok) return finish({ ok: false, reason: 'unreadable', detail: result.detail });
            const read = readAnswer(result.text, schema);
            if (!read.ok) return finish({ ok: false, reason: 'unreadable', detail: `the test answer: ${read.detail}` });
            return finish({ ok: true, data: read.data, text: read.text, answerText: result.text });
        }

        if (!list.length) {
            const where = ps.models.length ? `${c.purposeId}'s own list` : fileKind ? `the ${fileKind} list` : `the ${tier} tier`;
            return finish({ ok: false, reason: 'off', detail: fullList.length ? `no model in ${where} makes ${wanted}` : `no model is set for ${where} in Settings, AI` });
        }
        const needs = purposeReads(c.purpose).filter((k) => parts.some((p) => (k === 'pictures' ? p.kind === 'picture' : p.kind === 'pdf')));
        const deadline = started + (c.purpose.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
        let lastFailure: { failure: AttemptFailure; detail: string; wait?: number } | null = null;
        // A busy or slow model tells the app more than a later one with no key: try again soon.
        let busy: { failure: AttemptFailure; detail: string; wait?: number } | null = null;
        /** Models skipped because the text is longer than they take. */
        let tooLong = 0;

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
            const makeFiles = fileKind ? fileConnectorFor(preset) : undefined;
            const talk = fileKind ? undefined : connectorFor(preset.kind);
            if ((fileKind && !makeFiles) || (!fileKind && !talk)) {
                attempts.push({ connection: ref.connection, model: ref.model, outcome: 'skipped', ms: 0, detail: `Arc cannot make ${fileKind ?? 'text'} with ${preset.label} yet` });
                continue;
            }
            const voiceId = voiceOf(ref);
            const image = c.kind === 'image' ? fittedImage(c.settings.image, info.image) : undefined;
            const video = c.kind === 'video' ? fittedVideo(c.settings.video, info.video) : undefined;
            const audio = c.kind === 'audio' ? fittedAudio(c.settings.audio, info.audio) : undefined;
            if (c.kind === 'audio') {
                const skip = audioSkip(c.settings.audio, info.audio, c.purpose.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
                if (skip) {
                    attempts.push({ connection: ref.connection, model: ref.model, outcome: 'skipped', ms: 0, detail: skip });
                    continue;
                }
            }
            const avatarId = avatarOf(ref);
            if (c.kind === 'video') {
                const skip = videoSkip(c.settings.video, info.video, parts.some((p) => p.kind === 'picture'))
                    ?? (c.avatar && !avatarId ? `${preset.label} has no avatar for "${c.avatar}": choose one in Settings, AI, Purposes` : null);
                if (skip) {
                    attempts.push({ connection: ref.connection, model: ref.model, outcome: 'skipped', ms: 0, detail: skip });
                    continue;
                }
            }
            if (c.kind === 'image') {
                const skip = imageSkip(c.settings.image, info.image, parts.some((p) => p.kind === 'picture'));
                if (skip) {
                    attempts.push({ connection: ref.connection, model: ref.model, outcome: 'skipped', ms: 0, detail: skip });
                    continue;
                }
            }
            if (c.kind === 'speech') {
                const skip = speechSkip(info.speech, voiceId, preset.label);
                if (skip) {
                    if (skip.tooLong) tooLong++;
                    attempts.push({ connection: ref.connection, model: ref.model, outcome: 'skipped', ms: 0, detail: skip.detail });
                    continue;
                }
            }
            if (deadline - Date.now() < MIN_ATTEMPT_MS) {
                lastFailure = { failure: 'timeout', detail: 'no time was left for another model' };
                break;
            }
            last = ref;
            lastVoiceId = voiceId;
            lastImage = image ?? null;
            const attemptStarted = Date.now();
            // Music is made while the call waits: a model whose piece the time left cannot cover is
            // skipped before anything is sent or billed.
            const needMs = audio && info.audio?.type === 'music' ? ((audio.seconds ?? DEFAULT_AUDIO_SECONDS) + MUSIC_MARGIN_SECONDS) * 1000 : MIN_ATTEMPT_MS;
            if (needMs > MIN_ATTEMPT_MS && deadline - Date.now() < needMs) {
                attempts.push({ connection: ref.connection, model: ref.model, outcome: 'skipped', ms: 0, detail: `too little of the call's time is left for ${audio?.seconds ?? DEFAULT_AUDIO_SECONDS} seconds of music` });
                continue;
            }
            const place = await waitForPlace(pacingKey(connection, fileKind ?? undefined), connectionLimits(connection, fileKind ?? undefined), deadline, { leaveMs: needMs });
            let result: ConnectorResult | FileResult | JobStarted;
            if (!place.ok) {
                result = { ok: false, failure: 'unavailable', detail: `connection ${connection.id} is at its limit of requests (Settings, AI)`, wait: place.wait };
            } else {
                try {
                    // A key that cannot be read is that connection's problem: the next model may answer.
                    const key = presetNeedsKey(preset) ? await readKey(connection).catch((err: unknown) => ({ ok: false as const, detail: `the key of connection ${connection.id} could not be read: ${String((err as Error).message ?? err).slice(0, 160)}` })) : { ok: true as const, key: null };
                    if (!key.ok) result = { ok: false, failure: 'off', detail: key.detail };
                    else {
                        const send = () => (makeFiles
                            ? makeFiles({ connection, key: key.key }, { kind: fileKind!, model: ref.model, prompt: filePrompt(c.purpose, parts), parts: parts.filter((p) => p.kind !== 'text'), ...c.settings, ...(image ? { image } : {}), ...(video ? { video } : {}), ...(audio ? { audio } : {}), ...(voiceId ? { voice: voiceId } : {}), ...(avatarId ? { avatar: avatarId } : {}), ...(speechFile ? { speechFile } : {}), jobKey: recordId, timeoutMs: deadline - Date.now() })
                            : talk!({ connection, key: key.key }, {
                                model: ref.model,
                                instruction: instructionFor(c.purpose, schema, info.schema),
                                parts,
                                schema,
                                schemaSupport: info.schema,
                                maxOutputTokens: c.purpose.maxOutputTokens,
                                temperature: c.purpose.temperature,
                                thinking: c.purpose.thinking,
                                timeoutMs: deadline - Date.now(),
                            }));
                        result = await send();
                        // A provider's "too many requests" with a short wait: once more on the same model (AM-D15).
                        if (result.ok === false && result.rateLimited && result.wait !== undefined && result.wait <= MAX_RETRY_WAIT_S && Date.now() + result.wait * 1000 + MIN_ATTEMPT_MS < deadline) {
                            addSpent(info, ref, result.usage, [], image);
                            attempts.push({ connection: ref.connection, model: ref.model, outcome: 'unavailable', ms: Date.now() - attemptStarted, detail: result.detail.slice(0, 300) });
                            await sleep(result.wait * 1000);
                            result = await send();
                        }
                    }
                } finally {
                    await place.release();
                }
            }
            const ms = Date.now() - attemptStarted;
            if (result.ok === 'pending') {
                // A long job started: it is priced and counted when it ends.
                attempts.push({ connection: ref.connection, model: ref.model, outcome: 'pending', ms });
                return startJob({ connection: ref.connection, model: ref.model, operation: result.operation, video: video ?? null });
            }
            addSpent(info, ref, result.usage, result.ok && 'files' in result ? result.files : [], image);
            if (result.ok) {
                attempts.push({ connection: ref.connection, model: ref.model, outcome: 'ok', ms });
                // A file made by a provider that also answers text (Vertex, Sarvam) says nothing
                // of its text, so it does not mark the card working.
                if (!fileKind || !connectorFor(preset.kind)) await noteConnection(settings, ref.connection, null);
                if ('files' in result) {
                    if (!result.files.length) return finish({ ok: false, reason: 'unreadable', detail: 'the provider answered with no file' });
                    const paths = filePaths({ recordId, purpose: c.purposeId, month: fileMonth(started), test: false, saveTo, saveAs: saveTo ? c.saveAs ?? undefined : undefined, files: result.files });
                    let files: AiFile[];
                    try {
                        files = await saveFiles(paths, result.files, { recordId, purpose: c.purposeId, test: false });
                    } catch (err) {
                        // Billed but not saved: the call fails, keeps its units and is recorded with its cost.
                        console.error(`askAi: the files of a ${c.purposeId} call were not saved`, err);
                        return finish({ ok: false, reason: 'unavailable', detail: `the file was made but could not be saved: ${String((err as Error).message ?? err).slice(0, 200)}` });
                    }
                    // Pictures counted as asked: those a provider did not make are given back (AM-D23).
                    const asked = c.purpose.allowanceIn === 'pictures' ? allowanceAmount(c, 0) : 0;
                    if (allowance && asked > files.length) await allowance.release(asked - files.length);
                    // Seconds counted as asked: those not made (a model's shorter range) are given back.
                    if (allowance && c.purpose.allowanceIn === 'seconds' && c.kind === 'audio') {
                        const made = Math.ceil(files.reduce((n, f) => n + (f.seconds ?? 0), 0));
                        const counted = allowanceAmount(c, 0);
                        if (made > 0 && counted > made) await allowance.release(counted - made);
                    }
                    const hash = hashes.find((h) => h.ref.connection === ref.connection && h.ref.model === ref.model)?.hash;
                    if (hash) await storeCached({ hash, files, recordId, connection: ref.connection, model: ref.model, purpose: c.purposeId, days: cacheDays });
                    return finish({ ok: true, answerText: null, files });
                }
                const read = readAnswer(result.text, schema);
                if (!read.ok) return finish({ ok: false, reason: 'unreadable', detail: read.detail, answerText: result.text });
                return finish({ ok: true, data: read.data, text: read.text, answerText: result.text });
            }
            attempts.push({ connection: ref.connection, model: ref.model, outcome: result.failure, ms, detail: result.detail.slice(0, 300) });
            // A file kind's `off` is about this call (a voice, an API for that kind), not the
            // connection: it must not mark a card that also answers text as not working.
            if (result.failure === 'key-refused' || result.failure === 'retired' || (result.failure === 'off' && !fileKind) || result.outOfCredit) await noteConnection(settings, ref.connection, result.detail);
            if (result.outOfCredit) await alertOutOfCredit(connection.id, connection.label, result.detail);
            lastFailure = { failure: result.failure, detail: result.detail, wait: result.wait };
            if (result.failure === 'unavailable' || result.failure === 'timeout') busy = lastFailure;
            // A provider whose real cap is below what Arc knows: another speech model may take the text.
            if (!FALLBACK_FAILURES.includes(result.failure) && !(c.kind === 'speech' && result.failure === 'too-large')) break;
        }

        if (!lastFailure) {
            // Only when every model was too short for the text: another reason to skip says what to fix.
            if (tooLong && tooLong === attempts.length) {
                return finish({ ok: false, reason: 'too-large', detail: `the text (${inputSize.chars} characters) is longer than any model in the list takes in one request: send a paragraph at a time` });
            }
            // The first reason to skip that is not the text's length: that one has a fix in Settings, AI.
            const reasons = attempts.map((a) => a.detail).filter((d): d is string => !!d);
            const detail = attempts.length ? reasons.find((d) => !d.startsWith('takes at most')) ?? reasons[0] ?? `no model in the list can answer` : `no model is set in Settings, AI`;
            return finish({ ok: false, reason: 'off', detail: needs.length && attempts.every((a) => a.outcome === 'skipped' && a.detail?.startsWith('reads no')) ? `no model in the list reads ${needs.join(' or ')}` : detail });
        }
        const final = lastFailure.failure === 'off' && busy ? busy : lastFailure;
        return finish({ ok: false, reason: finalReason(final.failure), detail: final.detail, wait: final.wait });
    }

    /** Why a speech model cannot say this call's text, or null when it can (AM-D4, AM-D17, section 8 item 1). */
    function speechSkip(abilities: AiSpeechAbilities | undefined, voiceId: string | null, provider: string): { detail: string; tooLong?: boolean } | null {
        if (!voiceId) return { detail: `${provider} has no voice for "${c.voice}": choose one in Settings, AI, Purposes` };
        if (abilities?.voiceType && !voiceId.includes(`-${abilities.voiceType}-`)) return { detail: `"${voiceId}" is not a ${abilities.voiceType} voice, which this model speaks with` };
        const text = filePrompt(c.purpose, parts);
        if (abilities?.maxChars && text.length > abilities.maxChars) return { detail: `takes at most ${abilities.maxChars} characters a request`, tooLong: true };
        if (abilities?.maxBytes && Buffer.byteLength(text, 'utf8') > abilities.maxBytes) return { detail: `takes at most ${abilities.maxBytes} bytes of text a request`, tooLong: true };
        const format = c.settings.speech?.format ?? 'mp3';
        if (abilities && !abilities.formats.includes(format)) return { detail: `makes no ${format}` };
        const language = c.settings.speech?.language;
        // By the language alone, not the region: a provider that speaks en-IN reads en-US text too.
        const primary = (tag: string) => tag.split('-')[0].toLowerCase().replace(/^or$/, 'od');
        if (abilities?.languages && language && !abilities.languages.some((l) => primary(l) === primary(language))) return { detail: `speaks no ${language}` };
        return null;
    }

    /** Add one attempt's tokens, amount and cost to the call's. */
    function addSpent(info: ReturnType<typeof modelInfo>, ref: AiModelRef, usage: AttemptUsage | undefined, files: MadeFile[], image?: AiImageSettings): void {
        if (!usage && !files.length) return;
        const u: AttemptUsage = usage ?? { tokensIn: 0, tokensOut: 0, tokensThinking: 0 };
        spent.tokensIn += u.tokensIn;
        spent.tokensOut += u.tokensOut;
        spent.tokensThinking += u.tokensThinking;
        spent.tokensCached += u.tokensCached ?? 0;
        spent.tokensCacheWrite += u.tokensCacheWrite ?? 0;
        // What Arc counts itself, for a model billed by what it made or read.
        const counted = info.unit === 'pictures' ? files.length
            : info.unit === 'characters' ? inputSize.chars
                : info.unit === 'seconds' ? files.reduce((n, f) => n + (f.seconds ?? 0), 0) : 0;
        // A picture's price may change with its quality or resolution (AM-D5).
        const cost = attemptCost(image ? { ...info, price: picturePrice(info.image, info.price, image) } : info, u, counted);
        spent.costUsd += cost.usd;
        if (spent.unit !== cost.unit) spent.amount = 0;
        spent.unit = cost.unit;
        spent.amount += cost.amount;
        if (cost.from !== 'none') costFrom = costFrom === 'provider' || cost.from === 'provider' ? 'provider' : 'price-list';
        void ref;
    }
}
