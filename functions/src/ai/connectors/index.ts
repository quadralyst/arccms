import type { AiConnectorKind, AiFileConnectorKind, AiPreset } from '../presets.js';
import { anthropicConnector } from './anthropic.js';
import { geminiConnector } from './gemini.js';
import { openAiConnector } from './openai.js';
import { vertexConnector } from './vertex.js';
import type { Connector, FileConnector, FileProvider, VoiceLister } from './types.js';

/** The text connectors, by kind of provider. ElevenLabs and MiniMax make files only, so far. */
const CONNECTORS: Partial<Record<AiConnectorKind, Connector>> = {
    openai: openAiConnector,
    vertex: vertexConnector,
    anthropic: anthropicConnector,
    gemini: geminiConnector,
};

/**
 * The connectors that make files (specs/ai-media-spec.md, AM-D7), loaded only when a call
 * needs one (AM-D30), so a function that asks only text pays no cold start for them. Speech
 * since AM2; pictures, video and other audio arrive in AM3 to AM5.
 */
const FILE_PROVIDERS: Record<AiFileConnectorKind, () => Promise<FileProvider>> = {
    elevenlabs: async () => (await import('./elevenlabs.js')).elevenLabsProvider,
    sarvam: async () => (await import('./sarvam.js')).sarvamProvider,
    minimax: async () => (await import('./minimax.js')).miniMaxProvider,
    vertex: async () => (await import('./googleTts.js')).googleTtsProvider,
};

let replaced: Partial<Record<AiConnectorKind, Connector>> = {};
let replacedFiles: Partial<Record<AiFileConnectorKind | AiConnectorKind, FileConnector>> = {};
let replacedVoices: Partial<Record<AiFileConnectorKind, VoiceLister>> = {};

/** The text connector for a kind of provider, or undefined when it makes no text. */
export function connectorFor(kind: AiConnectorKind): Connector | undefined {
    return replaced[kind] ?? CONNECTORS[kind];
}

/** The file connector of a preset, or undefined when it makes no files. */
export function fileConnectorFor(preset: Pick<AiPreset, 'kind' | 'files'>): FileConnector | undefined {
    const test = (preset.files && replacedFiles[preset.files]) ?? replacedFiles[preset.kind];
    if (test) return test;
    const load = preset.files ? FILE_PROVIDERS[preset.files] : undefined;
    if (!load) return undefined;
    return async (context, request) => (await load()).make(context, request);
}

/** The voice list of a preset's provider, or undefined when it has none. */
export async function voiceListerFor(preset: Pick<AiPreset, 'files'>): Promise<VoiceLister | undefined> {
    if (!preset.files) return undefined;
    return replacedVoices[preset.files] ?? (await FILE_PROVIDERS[preset.files]()).voices;
}

/** For tests: answer with these connectors instead, until called again with {}. */
export function replaceConnectorsForTest(connectors: Partial<Record<AiConnectorKind, Connector>>): void {
    replaced = connectors;
}

/** For tests: make files with these connectors instead (by file connector, or by preset kind), until called again with {}. */
export function replaceFileConnectorsForTest(connectors: Partial<Record<AiFileConnectorKind | AiConnectorKind, FileConnector>>): void {
    replacedFiles = connectors;
}

/** For tests: list voices with these instead, until called again with {}. */
export function replaceVoiceListersForTest(listers: Partial<Record<AiFileConnectorKind, VoiceLister>>): void {
    replacedVoices = listers;
}
