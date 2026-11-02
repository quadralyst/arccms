import type { AiConnectorKind, AiFileConnectorKind, AiPreset } from '../presets.js';
import { anthropicConnector } from './anthropic.js';
import { geminiConnector } from './gemini.js';
import { openAiConnector } from './openai.js';
import { vertexConnector } from './vertex.js';
import type { AvatarLister, Connector, FileConnector, FileProvider, JobChecker, VoiceLister } from './types.js';

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
 * since AM2, pictures since AM3, video since AM4; other audio arrives in AM5.
 */
const FILE_PROVIDERS: Partial<Record<AiFileConnectorKind, () => Promise<FileProvider>>> = {
    elevenlabs: async () => (await import('./elevenlabs.js')).elevenLabsProvider,
    sarvam: async () => (await import('./sarvam.js')).sarvamProvider,
    minimax: async () => (await import('./minimax.js')).miniMaxProvider,
    vertex: async () => (await import('./vertexFiles.js')).vertexFileProvider,
    openai: async () => (await import('./openaiImages.js')).openAiFileProvider,
    gemini: async () => {
        const [images, video] = await Promise.all([import('./geminiImages.js'), import('./geminiVideo.js')]);
        return { make: (c, r) => (r.kind === 'video' ? video.omniStart(c, r) : images.geminiApiImages(c, r)), check: video.omniCheck };
    },
    dashscope: async () => (await import('./dashscope.js')).dashScopeProvider,
    kling: async () => (await import('./kling.js')).klingProvider,
    heygen: async () => (await import('./heygen.js')).heyGenProvider,
};

let replaced: Partial<Record<AiConnectorKind, Connector>> = {};
let replacedFiles: Partial<Record<AiFileConnectorKind | AiConnectorKind, FileConnector>> = {};
let replacedVoices: Partial<Record<AiFileConnectorKind, VoiceLister>> = {};
let replacedCheckers: Partial<Record<AiFileConnectorKind, JobChecker>> = {};
let replacedAvatars: Partial<Record<AiFileConnectorKind, AvatarLister>> = {};

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
    const load = FILE_PROVIDERS[preset.files];
    return replacedVoices[preset.files] ?? (load ? (await load()).voices : undefined);
}

/** How a preset's provider says how a long job is doing, or undefined when it has none. */
export async function jobCheckerFor(preset: Pick<AiPreset, 'files'>): Promise<JobChecker | undefined> {
    if (!preset.files) return undefined;
    const load = FILE_PROVIDERS[preset.files];
    return replacedCheckers[preset.files] ?? (load ? (await load()).check : undefined);
}

/** A presenter provider's avatar list, or undefined when it has none. */
export async function avatarListerFor(preset: Pick<AiPreset, 'files'>): Promise<AvatarLister | undefined> {
    if (!preset.files) return undefined;
    const load = FILE_PROVIDERS[preset.files];
    return replacedAvatars[preset.files] ?? (load ? (await load()).avatars : undefined);
}

/** For tests: check jobs and list avatars with these instead, until called again with {}. */
export function replaceJobCheckersForTest(checkers: Partial<Record<AiFileConnectorKind, JobChecker>>, avatars: Partial<Record<AiFileConnectorKind, AvatarLister>> = {}): void {
    replacedCheckers = checkers;
    replacedAvatars = avatars;
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
