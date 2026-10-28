/**
 * What every connector takes and returns (specs/ai-spec.md, AI-D5, AI-D6). askAi chooses
 * the model, checks the answer and keeps the record; a connector only sends one request to
 * one provider and says what came back, in these words.
 */
import type { JsonSchema } from '../schema.js';
import type { PreparedPart } from '../input.js';
import type { AiConnection } from '../settings.js';
import type { AiSchemaSupport } from '../presets.js';

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
    tokensIn: number;
    tokensOut: number;
    tokensThinking: number;
    /** USD, when the provider reports what it charged. */
    costUsd?: number;
}

export type ConnectorResult =
    | { ok: true; text: string; usage: AttemptUsage; requestId?: string }
    | { ok: false; failure: AttemptFailure; detail: string; wait?: number; usage?: AttemptUsage; requestId?: string };

export interface ConnectorContext {
    connection: AiConnection;
    /** The key, for a connector that needs one. */
    key: string | null;
}

export type Connector = (context: ConnectorContext, request: ConnectorRequest) => Promise<ConnectorResult>;

/** Failures after which the next model in the list tries. */
export const FALLBACK_FAILURES: readonly AttemptFailure[] = ['unavailable', 'timeout', 'retired', 'key-refused', 'off'];
