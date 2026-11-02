/**
 * What every connector takes and returns (specs/ai-spec.md, AI-D5, AI-D6;
 * specs/ai-media-spec.md, AM-D7). askAi chooses the model, checks the answer and keeps the
 * record; a connector only sends one request to one provider and says what came back, in
 * these words. A text connector answers text; a file connector answers files' bytes, which
 * askAi saves to Storage.
 */
import type { JsonSchema } from '../schema.js';
import type { PreparedPart } from '../input.js';
import type { AiConnection } from '../settings.js';
import type { AiSchemaSupport } from '../presets.js';
import type { AiAudioSettings, AiFileKind, AiImageSettings, AiSpeechSettings, AiVideoSettings, AiVoice } from '../types.js';

export interface ConnectorRequest {
    model: string;
    instruction: string;
    parts: PreparedPart[];
    /** The answer's shape, or null for text. */
    schema: JsonSchema | null;
    /** How the provider takes the schema: held to it (strict), or JSON only, with the schema in the instruction. */
    schemaSupport: AiSchemaSupport;
    maxOutputTokens?: number;
    temperature?: number;
    /** How much a model that thinks first may think, where the provider lets Arc say. */
    thinking?: 'low' | 'high';
    timeoutMs: number;
}

/**
 * Why an attempt gave no answer. `retired`, `key-refused`, `unavailable` and `timeout`
 * let the next model try (AI-D5); the others end the call.
 */
export type AttemptFailure = 'blocked' | 'too-large' | 'unavailable' | 'timeout' | 'retired' | 'key-refused' | 'unreadable' | 'off';

export interface AttemptUsage {
    /** Every input token, cached and cache writes included. */
    tokensIn: number;
    tokensOut: number;
    tokensThinking: number;
    /** Input tokens read from the provider's cache, part of tokensIn (AM-D31). */
    tokensCached?: number;
    /** Input tokens written to the provider's cache, part of tokensIn (AM-D31). */
    tokensCacheWrite?: number;
    /** For a model billed by pictures, characters or seconds: the amount the provider reports. */
    amount?: number;
    /** USD, when the provider reports what it charged. */
    costUsd?: number;
}

/** What a failed attempt adds: how long to wait, and whether the provider said why. */
interface FailureInfo {
    failure: AttemptFailure;
    detail: string;
    wait?: number;
    usage?: AttemptUsage;
    requestId?: string;
    /** The provider answered 429: too many requests (AM-D15). */
    rateLimited?: boolean;
    /** The provider says the account has no credit left (AM-D32). */
    outOfCredit?: boolean;
}

export type ConnectorResult =
    | { ok: true; text: string; usage: AttemptUsage; requestId?: string }
    | ({ ok: false } & FailureInfo);

export interface ConnectorContext {
    connection: AiConnection;
    /** The key, for a connector that needs one. */
    key: string | null;
}

export type Connector = (context: ConnectorContext, request: ConnectorRequest) => Promise<ConnectorResult>;

/** What a file connector is asked to make (AM-D19): the prompt, any input pictures, the settings. */
export interface FileRequest {
    kind: AiFileKind;
    model: string;
    /** The call's text with the purpose's instruction (its house style) after it. */
    prompt: string;
    /** Input pictures, for an edit or a video's first frame. */
    parts: PreparedPart[];
    image?: AiImageSettings;
    speech?: AiSpeechSettings;
    /** Speech: the provider's voice id, from the purpose's named voice (AM-D17). */
    voice?: string;
    audio?: AiAudioSettings;
    video?: AiVideoSettings;
    /** The purpose's extra fields for this provider, never the model, text or output. */
    providerOptions?: Record<string, unknown>;
    /** Presenter videos: the provider's avatar id, from the purpose's named avatar (AM-D33). */
    avatar?: string;
    /** Presenter videos: the audio the avatar speaks to, in place of the text. */
    speechFile?: { bytes: Buffer; mimeType: string };
    /** A long job: a key the provider may use so a retried start never makes two (HeyGen). */
    jobKey?: string;
    timeoutMs: number;
}

/** One file a model made, before Arc saves it. */
export interface MadeFile {
    bytes: Buffer;
    mimeType: string;
    width?: number;
    height?: number;
    seconds?: number;
}

export type FileResult =
    | { ok: true; files: MadeFile[]; usage: AttemptUsage; requestId?: string }
    | ({ ok: false } & FailureInfo);

/** A long job was started (AM-D12): Arc keeps it and asks how it is doing every minute. */
export interface JobStarted {
    ok: 'pending';
    /** The provider's id for it. */
    operation: string;
    usage?: AttemptUsage;
    requestId?: string;
}

export type FileConnector = (context: ConnectorContext, request: FileRequest) => Promise<FileResult | JobStarted>;

/** A file a finished job made: its bytes, or the provider's address for it, fetched by Arc. */
export type JobFile = MadeFile | { url: string; mimeType: string; width?: number; height?: number; seconds?: number };

/** How a job is doing. */
export type JobCheckResult =
    | { state: 'running' }
    | { state: 'done'; files: JobFile[]; usage: AttemptUsage; requestId?: string }
    | ({ state: 'failed' } & FailureInfo);

export interface JobCheckRequest {
    kind: AiFileKind;
    model: string;
    operation: string;
    /** The settings the job was started with. */
    video?: AiVideoSettings;
    timeoutMs: number;
}

export type JobChecker = (context: ConnectorContext, request: JobCheckRequest) => Promise<JobCheckResult>;

/** A presenter provider's avatars (AM-D33). */
export interface AiAvatar {
    id: string;
    name: string;
    gender: 'female' | 'male' | null;
    previewUrl: string | null;
    /** Its own voice, used when the purpose names none. */
    voiceId: string | null;
}
export type AvatarsResult = { ok: true; avatars: AiAvatar[] } | { ok: false; detail: string; keyRefused?: boolean };
export type AvatarLister = (context: ConnectorContext, options: { timeoutMs: number }) => Promise<AvatarsResult>;

/** A provider's voices (AM-D18), or why they could not be read. */
export type VoicesResult = { ok: true; voices: AiVoice[]; /** Shipped with Arc, no call made. */ fromDocs?: boolean } | { ok: false; detail: string; keyRefused?: boolean };

export type VoiceLister = (context: ConnectorContext, options: { timeoutMs: number }) => Promise<VoicesResult>;

/** What a provider's file connector offers: one function per kind it makes, and its voice list. */
export interface FileProvider {
    make: FileConnector;
    voices?: VoiceLister;
    /** For a provider whose files come from long jobs. */
    check?: JobChecker;
    avatars?: AvatarLister;
}

/** Failures after which the next model in the list tries. */
export const FALLBACK_FAILURES: readonly AttemptFailure[] = ['unavailable', 'timeout', 'retired', 'key-refused', 'off'];
