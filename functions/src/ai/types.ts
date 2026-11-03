/**
 * The types of Arc's AI capability (specs/ai-spec.md, docs/app/ai.html): what an app
 * declares in functions/src/custom/ai.ts, what it passes to askAi, and what comes back.
 */
import type { JsonSchema } from './schema.js';

export type { JsonSchema } from './schema.js';

/** How much model a purpose needs. Each tier is a list of models set in Settings, AI. */
export const AI_TIERS = ['cheap', 'fast', 'thorough'] as const;
export type AiTier = (typeof AI_TIERS)[number];

/**
 * What a purpose makes (specs/ai-media-spec.md, AM-D1). `text` and `data` are answers;
 * the others are files saved to Storage.
 */
export const AI_KINDS = ['text', 'data', 'image', 'speech', 'audio', 'video'] as const;
export type AiKind = (typeof AI_KINDS)[number];
/** The kinds whose answer is a file. */
export const AI_FILE_KINDS = ['image', 'speech', 'audio', 'video'] as const;
export type AiFileKind = (typeof AI_FILE_KINDS)[number];

/** What a model bills by (AM-D5). */
export const AI_UNITS = ['tokens', 'pictures', 'characters', 'seconds'] as const;
export type AiUnit = (typeof AI_UNITS)[number];

/** What a per-key allowance counts (AM-D23): calls (with their `units`), or the billed amount. */
export const AI_ALLOWANCE_UNITS = ['calls', 'pictures', 'characters', 'seconds'] as const;
export type AiAllowanceUnit = (typeof AI_ALLOWANCE_UNITS)[number];

/** Picture shapes in Arc's own words; each connector maps them to what its model takes (AM-D19). */
export const AI_ASPECTS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] as const;
export type AiAspect = (typeof AI_ASPECTS)[number];

/** Settings for a picture: the purpose's defaults, and what a call may change. */
export interface AiImageSettings {
    aspect?: AiAspect;
    /** `standard` is about 1 MP, `high` about 4 MP. */
    resolution?: 'standard' | 'high';
    quality?: 'low' | 'medium' | 'high';
    /** 1 to 4. */
    count?: number;
    seed?: number;
    negativePrompt?: string;
    format?: 'png' | 'jpeg' | 'webp';
}

/** Settings for speech. */
export interface AiSpeechSettings {
    /** BCP 47, such as `en-US` or `hi-IN`. */
    language?: string;
    /** 0.5 to 2. */
    speed?: number;
    format?: 'mp3' | 'wav' | 'opus';
    /** An instruction for models that take one, such as "calm and warm". */
    style?: string;
    /**
     * Hz, such as 22050. Left out: the model's own rate. A model that does not make this rate
     * in the format asked is skipped, as for a format it does not make.
     */
    sampleRate?: number;
}

/**
 * A named voice of a speech purpose (AM-D17): the voice id each provider uses for it, by
 * preset id (`elevenlabs`, `sarvam`, `minimax`, `vertex` for Google Cloud Text-to-Speech).
 * A provider left out is skipped for this voice until the admin chooses one in Settings, AI.
 */
export type AiVoiceMap = Record<string, string>;

/** One voice of a provider, as its list gives it (AM-D18). */
export interface AiVoice {
    /** The provider's voice id, what a voice map holds. */
    id: string;
    name: string;
    /** BCP 47 tags it speaks, where the provider says. */
    languages: string[];
    gender: 'female' | 'male' | 'neutral' | null;
    /** A few words such as an accent, an age or a use. */
    labels: string[];
    /** The provider's own sample, an https address, when it has one. */
    previewUrl: string | null;
    /** The models it works with, when the provider says; empty: every model of the provider. */
    models: string[];
}

/** Settings for other audio: a sound or music. */
export interface AiAudioSettings {
    /** What it is: a sound effect or music (AM5). Left out: whichever the model makes. */
    type?: 'sound' | 'music';
    /** How long, 0.5 to 600; each model makes its own range (sound effects up to 30, music 3 to 300). */
    seconds?: number;
    /** A sound that loops smoothly, where the model makes one. */
    loop?: boolean;
    /** Music only: no vocals. */
    instrumental?: boolean;
    format?: 'mp3' | 'wav';
}

/** Settings for a video. */
export interface AiVideoSettings {
    seconds?: number;
    aspect?: AiAspect;
    resolution?: '480p' | '720p' | '1080p' | '4k';
    sound?: boolean;
    seed?: number;
    negativePrompt?: string;
    /** A purpose's only: an avatar speaking the call's text, or to an audio file (AM-D33, HeyGen). */
    presenter?: boolean;
}

/** A file a model made, saved in the install's bucket (AM-D9). */
export interface AiFile {
    /** The path in the bucket, such as `ai-files/cover/2026-11/abc-1.png`. */
    path: string;
    mimeType: string;
    bytes: number;
    width?: number;
    height?: number;
    seconds?: number;
}

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
    /**
     * What the purpose makes (AM-D1). Default: `data` when `output` has a schema, else `text`.
     * `image`, `speech`, `audio` and `video` answer with files saved to Storage.
     */
    makes?: AiKind;
    /**
     * The instruction (prompt) the model follows. Needed for text and data; for a file kind
     * it is optional, such as a house style added after the call's own prompt.
     */
    instruction?: string;
    /** A picture's defaults, for `makes: 'image'`. */
    image?: AiImageSettings;
    /** Speech's defaults, for `makes: 'speech'`. */
    speech?: AiSpeechSettings;
    /**
     * Presenter videos only (`video: { presenter: true }`, AM-D33): the avatars a call may ask
     * for by name, first one the default, such as `{ host: { heygen: '<look id>' } }`. A call
     * passes `avatar: 'host'`, never a provider's id. Left out: one avatar, `default`, which
     * the admin chooses in Settings, AI.
     */
    avatars?: Record<string, AiVoiceMap>;
    /**
     * Video and other long jobs (AM-D12): how long a job may run before it fails with
     * `timeout`, 5 to 120 minutes. Default 30.
     */
    jobTimeoutMinutes?: number;
    /**
     * A long job ended (AM-D13): run by Arc's background check with the outcome and the job,
     * so the app writes the file's path to its own documents. A throw is logged and the hook
     * runs again on the next checks, at most 3 times in all.
     */
    onJobDone?: (result: AiJobResult, job: AiJob) => Promise<void> | void;
    /**
     * Speech only: the voices a call may ask for by name, first one the default (AM-D17),
     * such as `{ narrator: { elevenlabs: '<voice id>', sarvam: 'priya' } }`. A call passes
     * `voice: 'narrator'`, never a provider's id, so the app's code stays the same across
     * providers. Left out: one voice, `default`, which the admin maps in Settings, AI.
     */
    voices?: Record<string, AiVoiceMap>;
    /**
     * Pictures only: offer this purpose in the Media Manager's "Create with AI" tab (AM-D24),
     * so a picker can open on it with the app's house style (its `instruction`). Its models
     * and allowance apply there, but not its `saveTo`: pictures made in the tab stay in
     * `ai-files/` until one is saved to the library.
     */
    mediaManager?: boolean;
    /** A sound's or music's defaults, for `makes: 'audio'`. */
    audio?: AiAudioSettings;
    /** A video's defaults, for `makes: 'video'`. */
    video?: AiVideoSettings;
    /**
     * A file kind only: the folder in the bucket its files are saved in, such as
     * `app/article-audio`, where the app's own rules serve them. Default: Arc's private
     * `ai-files/` folder, which only admins read (AM-D9).
     */
    saveTo?: string;
    /** A file kind only: delete files left in `ai-files/` this many days after they were made (AM-D10). */
    deleteAfterDays?: number;
    /**
     * A file kind only: the same input gives the same file, with no new call and no charge
     * (AM-D16). `true` keeps a file for 365 days; `{ days }` for that many.
     */
    cache?: boolean | { days: number };
    /** `false`: only the first model of the list answers, never a fallback (AM-D4). Default true. */
    fallback?: boolean;
    /**
     * What the per-key allowance counts (AM-D23): `calls` (the default, `units` a call), or
     * the billed amount, `pictures`, `characters` or `seconds`.
     */
    allowanceIn?: AiAllowanceUnit;
    /** The answer: text, or data of this shape (checked by Arc). Default: text. */
    output?: 'text' | { schema: JsonSchema };
    /** Which tier's models answer, unless the admin sets models for the purpose. Default: fast. */
    tier?: AiTier;
    /** How many units one key may use a day, unless the admin changes it. No limit when left out. */
    perKeyPerDay?: number;
    /** What a `limitKey` is, in a word, such as `merchant`, for Settings, AI. Default: user or business. */
    limitKeyLabel?: string;
    /** The answer in test mode. Default: one built from the schema, or a short text. */
    testAnswer?: AiTestAnswer;
    /** The most tokens the answer may take. Default: the model's own limit. */
    maxOutputTokens?: number;
    /** 0 to 2. Default: the model's own. */
    temperature?: number;
    /**
     * For a model that thinks before it answers: `low` for quick reading and sorting (faster,
     * fewer billed tokens), `high` for hard reasoning. Default: the model's own. Sent to
     * OpenRouter, OpenAI and Gemini; other providers ignore it.
     */
    thinking?: 'low' | 'high';
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
    /**
     * This key's own allowance today, such as from its plan: a whole number from 0, in place of
     * the admin's and the purpose's. Needs a `limitKey`.
     */
    perDay?: number;
    /** The app's own reference, kept on the record, such as `businesses/b1/scans/s4`. */
    ref?: string;
    /**
     * A file kind: the full path to save the (first) file at, inside the purpose's `saveTo`
     * folder, such as `app/article-audio/a1/p3.mp3` (AM-D9). More files get `-2`, `-3`.
     */
    saveAs?: string;
    /** A picture's settings for this call, over the purpose's. */
    image?: AiImageSettings;
    /** Speech settings for this call, over the purpose's. */
    speech?: Pick<AiSpeechSettings, 'language' | 'speed' | 'sampleRate'>;
    /** Speech only: one of the purpose's named voices. Default: its first. */
    voice?: string;
    /** A sound's or music's length for this call. */
    audio?: Pick<AiAudioSettings, 'seconds'>;
    /** A video's settings for this call, over the purpose's. */
    video?: Omit<AiVideoSettings, 'presenter'>;
    /** Presenter videos: one of the purpose's named avatars. Default: its first. */
    avatar?: string;
    /** Presenter videos: an audio file in the bucket the avatar speaks to, in place of the text. */
    speechFile?: { storagePath: string };
    /** A long job: up to 10 `arccms_uid` values who may read the job from a browser (AM-D13). */
    readers?: string[];
}

/** A long job's state (AM-D12), as aiJob() and a browser reading `AiJobs/{id}` see it. */
export interface AiJob {
    id: string;
    purpose: string;
    kind: AiKind;
    status: 'pending' | 'done' | 'failed';
    /** The call's record, which is brought up to date when the job ends. */
    recordId: string;
    ref: string | null;
    limitKey: string | null;
    readers: string[];
    startedAt: Date;
    endedAt: Date | null;
    files: AiFile[];
    reason: AiFailureReason | null;
    detail: string | null;
    costUsd: number;
    test: boolean;
}

/** What onJobDone is given: the job's files, or why it failed. */
export type AiJobResult = { ok: true; files: AiFile[]; costUsd: number } | { ok: false; reason: AiFailureReason; detail: string | null };

/** Tokens and cost of a call. */
export interface AiUsage {
    /** The model that answered, or the last one tried. */
    model: string | null;
    connection: string | null;
    tokensIn: number;
    tokensOut: number;
    /** Thinking tokens, when the provider counts them apart (included in its bill). */
    tokensThinking: number;
    /** Input tokens read from the provider's cache, part of tokensIn (AM-D31). */
    tokensCached: number;
    /** Input tokens written to the provider's cache, part of tokensIn (AM-D31). */
    tokensCacheWrite: number;
    /** What the purpose makes. */
    kind: AiKind;
    /** How much was billed, in `unit`: tokens in and out, pictures, characters or seconds. */
    amount: number;
    unit: AiUnit;
    /** USD. 0 in test mode and for a model with no price. */
    costUsd: number;
    ms: number;
    test: boolean;
}

export type AskAiResult =
    | {
        ok: true;
        data?: unknown;
        text?: string;
        /** The files made, for a file kind. */
        files?: AiFile[];
        /** The answer came from Arc's own cache: no provider was called (AM-D16). */
        cached?: boolean;
        /** Pictures: the settings the model was asked with, fitted to it, such as the nearest shape (AM-D19). */
        image?: AiImageSettings;
        usage: AiUsage;
        recordId: string | null;
    }
    | {
        /**
         * A long job, such as a video: it goes on in the background (AM-D12). A text or data
         * purpose never gets it. The other fields are named, always empty, so code written for
         * `if (r.ok)` or `if (r.ok !== true)` before jobs still type-checks.
         */
        ok: 'pending';
        jobId: string;
        usage: AiUsage;
        recordId: string | null;
        data?: undefined;
        text?: undefined;
        files?: undefined;
        cached?: undefined;
        image?: undefined;
        reason?: undefined;
        scope?: undefined;
        wait?: undefined;
        detail?: undefined;
    }
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
