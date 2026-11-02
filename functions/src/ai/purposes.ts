import { AI_PURPOSES } from '../custom/ai.js';
import { storagePathProblem } from './paths.js';
import { answerProblems, schemaProblems, type JsonSchema } from './schema.js';
import { AI_ALLOWANCE_UNITS, AI_ASPECTS, AI_FILE_KINDS, AI_KINDS, AI_TIERS, isAiTestFailure, type AiFileKind, type AiKind, type AiPurpose, type AiPurposes, type AiTier } from './types.js';

/**
 * The app's AI purposes, from functions/src/custom/ai.ts, checked once when the functions
 * load (specs/ai-spec.md, AI-D2): a mistake stops them loading, so the deploy fails with
 * the reason rather than a call failing later.
 */

const PURPOSE_ID = /^[a-z][a-z0-9-]{1,39}$/;
export const DEFAULT_TEXT_CHARS = 20_000;
export const MAX_FILE_MB = 15;
export const MAX_FILES = 20;
export const DEFAULT_TIMEOUT_SECONDS = 60;
export const DEFAULT_CACHE_DAYS = 365;
export const MAX_PICTURES = 4;

/** What a purpose's file-kind settings may hold, with the check for each (AM-D19). */
export function fileSettingsProblems(at: string, p: AiPurpose, kind: AiKind): string[] {
    const problems: string[] = [];
    const blocks = { image: p.image, speech: p.speech, audio: p.audio, video: p.video } as Record<AiFileKind, unknown>;
    for (const k of AI_FILE_KINDS) {
        if (blocks[k] !== undefined && k !== kind) problems.push(`${at}: ${k} settings belong to a purpose that makes ${k}, and this one makes ${kind}`);
    }
    const image = p.image;
    if (image && kind === 'image') {
        if (image.aspect !== undefined && !AI_ASPECTS.includes(image.aspect)) problems.push(`${at}: image.aspect must be one of ${AI_ASPECTS.join(', ')}`);
        if (image.resolution !== undefined && image.resolution !== 'standard' && image.resolution !== 'high') problems.push(`${at}: image.resolution must be 'standard' or 'high'`);
        if (image.quality !== undefined && !['low', 'medium', 'high'].includes(image.quality)) problems.push(`${at}: image.quality must be 'low', 'medium' or 'high'`);
        if (image.count !== undefined && (!Number.isInteger(image.count) || image.count < 1 || image.count > MAX_PICTURES)) problems.push(`${at}: image.count must be a whole number from 1 to ${MAX_PICTURES}`);
        if (image.format !== undefined && !['png', 'jpeg', 'webp'].includes(image.format)) problems.push(`${at}: image.format must be 'png', 'jpeg' or 'webp'`);
    }
    const speech = p.speech;
    if (speech && kind === 'speech') {
        if (speech.speed !== undefined && (typeof speech.speed !== 'number' || speech.speed < 0.5 || speech.speed > 2)) problems.push(`${at}: speech.speed must be from 0.5 to 2`);
        if (speech.format !== undefined && !['mp3', 'wav', 'opus'].includes(speech.format)) problems.push(`${at}: speech.format must be 'mp3', 'wav' or 'opus'`);
        if (speech.language !== undefined && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(speech.language)) problems.push(`${at}: speech.language must be a language tag such as en-US or hi-IN`);
    }
    const audio = p.audio;
    if (audio && kind === 'audio') {
        if (audio.seconds !== undefined && (typeof audio.seconds !== 'number' || audio.seconds < 0.5 || audio.seconds > 600)) problems.push(`${at}: audio.seconds must be from 0.5 to 600`);
        if (audio.format !== undefined && !['mp3', 'wav'].includes(audio.format)) problems.push(`${at}: audio.format must be 'mp3' or 'wav'`);
    }
    const video = p.video;
    if (video && kind === 'video') {
        if (video.seconds !== undefined && (typeof video.seconds !== 'number' || video.seconds < 1 || video.seconds > 60)) problems.push(`${at}: video.seconds must be from 1 to 60`);
        if (video.aspect !== undefined && !AI_ASPECTS.includes(video.aspect)) problems.push(`${at}: video.aspect must be one of ${AI_ASPECTS.join(', ')}`);
        if (video.resolution !== undefined && !['480p', '720p', '1080p', '4k'].includes(video.resolution)) problems.push(`${at}: video.resolution must be 480p, 720p, 1080p or 4k`);
    }
    return problems;
}

/** What is wrong with the purposes, one line each; [] when they can be used. */
export function purposeProblems(purposes: unknown): string[] {
    if (typeof purposes !== 'object' || purposes === null || Array.isArray(purposes)) return ['AI_PURPOSES must be an object of purposes by id'];
    const problems: string[] = [];
    for (const [id, raw] of Object.entries(purposes)) {
        const at = `purpose "${id}"`;
        if (!PURPOSE_ID.test(id)) problems.push(`${at}: the id must be lower case letters, digits and -, starting with a letter, 2 to 40 characters`);
        else if (id.startsWith('arc-')) problems.push(`${at}: ids starting with arc- are Arc's own`);
        if (typeof raw !== 'object' || raw === null) {
            problems.push(`${at} must be an object`);
            continue;
        }
        const p = raw as AiPurpose;
        if (typeof p.label !== 'string' || !p.label.trim()) problems.push(`${at} needs a label`);
        if (p.makes !== undefined && !AI_KINDS.includes(p.makes)) problems.push(`${at}: makes must be one of ${AI_KINDS.join(', ')}`);
        const kind = purposeKind(p);
        const file = isFileKind(kind);
        if (!file && (typeof p.instruction !== 'string' || !p.instruction.trim())) problems.push(`${at} needs an instruction`);
        if (file && p.instruction !== undefined && typeof p.instruction !== 'string') problems.push(`${at}: instruction must be text`);
        if (p.makes === 'data' && (!p.output || p.output === 'text')) problems.push(`${at}: a purpose that makes data needs output: { schema }`);
        if (p.makes === 'text' && p.output && p.output !== 'text') problems.push(`${at}: a purpose that makes text takes no schema; make it 'data'`);
        if (file && p.output !== undefined) problems.push(`${at}: a purpose that makes ${kind} answers with files, so it takes no output`);
        if (file) problems.push(...fileSettingsProblems(at, p, kind));
        for (const k of ['image', 'speech', 'audio', 'video'] as const) {
            if (!file && p[k] !== undefined) problems.push(`${at}: ${k} settings belong to a purpose that makes ${k}`);
        }
        if (p.saveTo !== undefined) {
            if (!file) problems.push(`${at}: saveTo is for a purpose that makes files`);
            else {
                const problem = storagePathProblem(p.saveTo, 'saveTo');
                if (problem) problems.push(`${at}: ${problem}`);
            }
        }
        if (p.deleteAfterDays !== undefined && (!file || !Number.isInteger(p.deleteAfterDays) || p.deleteAfterDays < 1 || p.deleteAfterDays > 3650)) problems.push(`${at}: deleteAfterDays is for a purpose that makes files, a whole number from 1 to 3650`);
        if (p.cache !== undefined) {
            const days = typeof p.cache === 'object' && p.cache !== null ? p.cache.days : null;
            if (!file) problems.push(`${at}: cache is for a purpose that makes files`);
            else if (typeof p.cache !== 'boolean' && (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 3650)) problems.push(`${at}: cache must be true, false or { days } with 1 to 3650 days`);
        }
        if (p.fallback !== undefined && typeof p.fallback !== 'boolean') problems.push(`${at}: fallback must be true or false`);
        if (p.allowanceIn !== undefined && !AI_ALLOWANCE_UNITS.includes(p.allowanceIn)) problems.push(`${at}: allowanceIn must be one of ${AI_ALLOWANCE_UNITS.join(', ')}`);
        if (p.allowanceIn === 'pictures' && kind !== 'image') problems.push(`${at}: allowanceIn 'pictures' is for a purpose that makes pictures`);
        if (p.allowanceIn === 'seconds' && kind !== 'audio' && kind !== 'video') problems.push(`${at}: allowanceIn 'seconds' is for a purpose that makes audio or video`);
        if (p.allowanceIn === 'characters' && kind !== 'speech' && kind !== 'text' && kind !== 'data') problems.push(`${at}: allowanceIn 'characters' counts the text sent, for speech, text or data`);
        if (p.tier !== undefined && !AI_TIERS.includes(p.tier)) problems.push(`${at}: tier must be one of ${AI_TIERS.join(', ')}`);
        if (p.perKeyPerDay !== undefined && (!Number.isInteger(p.perKeyPerDay) || p.perKeyPerDay < 1)) problems.push(`${at}: perKeyPerDay must be a whole number of 1 or more`);
        if (p.limitKeyLabel !== undefined && (typeof p.limitKeyLabel !== 'string' || !p.limitKeyLabel.trim() || p.limitKeyLabel.length > 40)) problems.push(`${at}: limitKeyLabel must be a word or two, at most 40 characters, such as 'merchant'`);
        if (p.maxOutputTokens !== undefined && (!Number.isInteger(p.maxOutputTokens) || p.maxOutputTokens < 1)) problems.push(`${at}: maxOutputTokens must be a whole number of 1 or more`);
        if (p.temperature !== undefined && (typeof p.temperature !== 'number' || p.temperature < 0 || p.temperature > 2)) problems.push(`${at}: temperature must be from 0 to 2`);
        if (p.thinking !== undefined && p.thinking !== 'low' && p.thinking !== 'high') problems.push(`${at}: thinking must be 'low' or 'high'`);
        if (p.timeoutSeconds !== undefined && (!Number.isInteger(p.timeoutSeconds) || p.timeoutSeconds < 5 || p.timeoutSeconds > 540)) problems.push(`${at}: timeoutSeconds must be a whole number from 5 to 540`);
        const input = p.input ?? {};
        if (input.text !== undefined && (!Number.isInteger(input.text.maxChars) || input.text.maxChars < 1)) problems.push(`${at}: input.text.maxChars must be a whole number of 1 or more`);
        for (const kind of ['pictures', 'pdfs'] as const) {
            const limit = input[kind];
            if (limit === undefined) continue;
            if (!Number.isInteger(limit.max) || limit.max < 1 || limit.max > MAX_FILES) problems.push(`${at}: input.${kind}.max must be a whole number from 1 to ${MAX_FILES}`);
            if (typeof limit.maxMb !== 'number' || limit.maxMb <= 0 || limit.maxMb > MAX_FILE_MB) problems.push(`${at}: input.${kind}.maxMb must be more than 0 and at most ${MAX_FILE_MB}`);
        }
        const output = p.output ?? 'text';
        if (output !== 'text') {
            if (typeof output !== 'object' || output === null || !('schema' in output)) problems.push(`${at}: output must be 'text' or { schema }`);
            else {
                const sp = schemaProblems(output.schema, 'output.schema');
                problems.push(...sp.map((s) => `${at}: ${s}`));
                // A fixed test answer is checked now, so test mode cannot hide a wrong one.
                const t = p.testAnswer;
                if (!sp.length && t !== undefined && typeof t !== 'function' && !isAiTestFailure(t)) {
                    problems.push(...answerProblems(t, output.schema, 'testAnswer').map((s) => `${at}: ${s}`));
                }
            }
        }
    }
    return problems;
}

/** Stops the functions loading when the purposes are wrong, naming the file. */
export function assertPurposes(purposes: unknown): void {
    const problems = purposeProblems(purposes);
    if (problems.length) throw new Error(`functions/src/custom/ai.ts:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
}

assertPurposes(AI_PURPOSES);

/** The app's purposes. */
export function aiPurposes(): AiPurposes {
    return AI_PURPOSES;
}

/** The purpose with this id, or undefined. */
export function findPurpose(id: string): AiPurpose | undefined {
    return Object.prototype.hasOwnProperty.call(AI_PURPOSES, id) ? AI_PURPOSES[id] : undefined;
}

/** What a purpose makes: its `makes`, else data for a schema, else text (AM-D1). */
export function purposeKind(p: AiPurpose): AiKind {
    if (p.makes) return p.makes;
    return p.output && p.output !== 'text' ? 'data' : 'text';
}

export function isFileKind(kind: AiKind): kind is AiFileKind {
    return (AI_FILE_KINDS as readonly string[]).includes(kind);
}

/** How many days a purpose's cache keeps a file, or 0 when it has no cache (before the admin's word). */
export function purposeCacheDays(p: AiPurpose): number {
    if (!p.cache) return 0;
    return p.cache === true ? DEFAULT_CACHE_DAYS : p.cache.days;
}

export function purposeTier(p: AiPurpose): AiTier {
    return p.tier ?? 'fast';
}

export function purposeSchema(p: AiPurpose): JsonSchema | null {
    return p.output && p.output !== 'text' ? p.output.schema : null;
}

/** What a purpose takes, for the admin page and for choosing models that can read it. */
export function purposeReads(p: AiPurpose): Array<'pictures' | 'pdfs'> {
    return (['pictures', 'pdfs'] as const).filter((k) => p.input?.[k] !== undefined);
}
