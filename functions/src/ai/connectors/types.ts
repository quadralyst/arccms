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

export type FileConnector = (context: ConnectorContext, request: FileRequest) => Promise<FileResult>;

/** A provider's voices (AM-D18), or why they could not be read. */
export type VoicesResult = { ok: true; voices: AiVoice[]; /** Shipped with Arc, no call made. */ fromDocs?: boolean } | { ok: false; detail: string; keyRefused?: boolean };

export type VoiceLister = (context: ConnectorContext, options: { timeoutMs: number }) => Promise<VoicesResult>;

/** What a provider's file connector offers: one function per kind it makes, and its voice list. */
export interface FileProvider {
    make: FileConnector;
    voices?: VoiceLister;
}

/** Failures after which the next model in the list tries. */
export const FALLBACK_FAILURES: readonly AttemptFailure[] = ['unavailable', 'timeout', 'retired', 'key-refused', 'off'];
