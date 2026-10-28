/**
 * The types of Arc's AI capability (specs/ai-spec.md, docs/app/ai.html): what an app
 * declares in functions/src/custom/ai.ts, what it passes to askAi, and what comes back.
 */
import type { JsonSchema } from './schema.js';

export type { JsonSchema } from './schema.js';

/** How much model a purpose needs. Each tier is a list of models set in Settings, AI. */
export const AI_TIERS = ['cheap', 'fast', 'thorough'] as const;
export type AiTier = (typeof AI_TIERS)[number];

/** Why a call gave no answer (AI-D9). */
export const AI_FAILURE_REASONS = ['unreadable', 'blocked', 'too-large', 'limit', 'unavailable', 'timeout', 'off'] as const;
export type AiFailureReason = (typeof AI_FAILURE_REASONS)[number];

/** Pictures and documents a purpose takes, with the most it takes. */
export interface AiFileLimit {
    /** How many in one call, 1 to 20. */
    max: number;
    /** The largest one, in MB, at most 20. */
    maxMb: number;
}

/** What an answer in test mode is given (AI-D16). */
export interface AiTestInput {
    /** The text parts, in order. */
    text: string[];
    /** The pictures and documents: their type, size and name. */
    files: Array<{ mimeType: string; bytes: number; name: string | null }>;
    limitKey: string | null;
    ref: string | null;
}

/** A failure a test answer stands for, made with aiTestFailure(). */
export interface AiTestFailure {
    readonly aiTestFailure: AiFailureReason;
    readonly wait?: number;
    readonly detail?: string;
}

/** A test answer: the data or text itself, a failure, or a function of the input that returns either. */
export type AiTestAnswer = unknown | AiTestFailure | ((input: AiTestInput) => unknown);

/** One purpose, as the app declares it in functions/src/custom/ai.ts (AI-D2). */
export interface AiPurpose {
    /** The name admins see, such as "Menu scan". */
    label: string;
    /** One sentence on what it does, shown in Settings, AI. */
    description?: string;
    /**
     * What a call may send besides text. Text is always allowed, up to `text.maxChars`
     * (default 20,000 characters).
     */
    input?: {
        text?: { maxChars: number };
        /** JPEG, PNG or WebP. */
        pictures?: AiFileLimit;
        pdfs?: AiFileLimit;
    };
    /** The instruction (prompt) the model follows. */
    instruction: string;
    /** The answer: text, or data of this shape (checked by Arc). Default: text. */
    output?: 'text' | { schema: JsonSchema };
    /** Which tier's models answer, unless the admin sets models for the purpose. Default: fast. */
    tier?: AiTier;
    /** How many units one key may use a day, unless the admin changes it. No limit when left out. */
    perKeyPerDay?: number;
    /** The answer in test mode. Default: one built from the schema, or a short text. */
    testAnswer?: AiTestAnswer;
    /** The most tokens the answer may take. Default: the model's own limit. */
    maxOutputTokens?: number;
    /** 0 to 2. Default: the model's own. */
    temperature?: number;
    /** How long the whole call may take, all fallbacks together, 5 to 540. Default 60. */
    timeoutSeconds?: number;
}

/** The app's purposes, by id: lower case letters, digits and -, such as `menu-scan`. */
export type AiPurposes = Record<string, AiPurpose>;

/** One piece of a call's input. */
export type AiInputPart =
    | string
    | { text: string }
    /** A file in the install's Storage bucket, such as `app/menus/b1/p1.jpg`. */
    | { storagePath: string; mimeType?: string }
    | { bytes: Buffer | Uint8Array; mimeType: string; name?: string };

export interface AskAiInput {
    /** One of the app's purposes. */
    purpose: string;
    /** Text, pictures and documents, in the order the model reads them. */
    input?: AiInputPart | AiInputPart[];
    /** Whose allowance this call uses, such as a business id. Needed when the purpose has a per-key allowance. */
    limitKey?: string;
    /** How much of the allowance it uses, such as the number of pages. Default 1. */
    units?: number;
    /** The app's own reference, kept on the record, such as `businesses/b1/scans/s4`. */
    ref?: string;
}

/** Tokens and cost of a call. */
export interface AiUsage {
    /** The model that answered, or the last one tried. */
    model: string | null;
    connection: string | null;
    tokensIn: number;
    tokensOut: number;
    /** Thinking tokens, when the provider counts them apart (included in its bill). */
    tokensThinking: number;
    /** USD. 0 in test mode and for a model with no price. */
    costUsd: number;
    ms: number;
    test: boolean;
}

export type AskAiResult =
    | { ok: true; data?: unknown; text?: string; usage: AiUsage; recordId: string | null }
    | {
        ok: false;
        reason: AiFailureReason;
        /** For `limit`: whose limit, the key's allowance or the month's budget. */
        scope?: 'key' | 'budget';
        /** Seconds until trying again may work. */
        wait?: number;
        /** What happened, for logs and the admin; not for the person on screen. */
        detail?: string;
        usage: AiUsage;
        recordId: string | null;
    };

/** A failure for a test answer: testAnswer: aiTestFailure('blocked'). */
export function aiTestFailure(reason: AiFailureReason, options: { wait?: number; detail?: string } = {}): AiTestFailure {
    return { aiTestFailure: reason, ...options };
}

export function isAiTestFailure(value: unknown): value is AiTestFailure {
    return typeof value === 'object' && value !== null && typeof (value as AiTestFailure).aiTestFailure === 'string';
}
