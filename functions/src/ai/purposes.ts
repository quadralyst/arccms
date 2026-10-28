import { AI_PURPOSES } from '../custom/ai.js';
import { answerProblems, schemaProblems, type JsonSchema } from './schema.js';
import { AI_TIERS, isAiTestFailure, type AiPurpose, type AiPurposes, type AiTier } from './types.js';

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
        if (typeof p.instruction !== 'string' || !p.instruction.trim()) problems.push(`${at} needs an instruction`);
        if (p.tier !== undefined && !AI_TIERS.includes(p.tier)) problems.push(`${at}: tier must be one of ${AI_TIERS.join(', ')}`);
        if (p.perKeyPerDay !== undefined && (!Number.isInteger(p.perKeyPerDay) || p.perKeyPerDay < 1)) problems.push(`${at}: perKeyPerDay must be a whole number of 1 or more`);
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
