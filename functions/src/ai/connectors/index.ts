import type { AiConnectorKind } from '../presets.js';
import { anthropicConnector } from './anthropic.js';
import { geminiConnector } from './gemini.js';
import { openAiConnector } from './openai.js';
import { vertexConnector } from './vertex.js';
import type { Connector, FileConnector } from './types.js';

const CONNECTORS: Record<AiConnectorKind, Connector> = {
    openai: openAiConnector,
    vertex: vertexConnector,
    anthropic: anthropicConnector,
    gemini: geminiConnector,
};

/**
 * The connectors that make files, by kind of provider (specs/ai-media-spec.md, AM-D7). None
 * yet: speech, pictures, video and other audio arrive in AM2 to AM5. Until then a file
 * purpose answers in test mode only, and `off` live.
 */
const FILE_CONNECTORS: Partial<Record<AiConnectorKind, FileConnector>> = {};

let replaced: Partial<Record<AiConnectorKind, Connector>> = {};
let replacedFiles: Partial<Record<AiConnectorKind, FileConnector>> = {};

/** The connector for a kind of provider. */
export function connectorFor(kind: AiConnectorKind): Connector {
    return replaced[kind] ?? CONNECTORS[kind];
}

/** The file connector for a kind of provider, or undefined when it makes no files. */
export function fileConnectorFor(kind: AiConnectorKind): FileConnector | undefined {
    return replacedFiles[kind] ?? FILE_CONNECTORS[kind];
}

/** For tests: answer with these connectors instead, until called again with {}. */
export function replaceConnectorsForTest(connectors: Partial<Record<AiConnectorKind, Connector>>): void {
    replaced = connectors;
}

/** For tests: make files with these connectors instead, until called again with {}. */
export function replaceFileConnectorsForTest(connectors: Partial<Record<AiConnectorKind, FileConnector>>): void {
    replacedFiles = connectors;
}
