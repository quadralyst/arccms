import type { AiConnectorKind } from '../presets.js';
import { openAiConnector } from './openai.js';
import { vertexConnector } from './vertex.js';
import type { Connector } from './types.js';

const CONNECTORS: Record<AiConnectorKind, Connector> = {
    openai: openAiConnector,
    vertex: vertexConnector,
};

let replaced: Partial<Record<AiConnectorKind, Connector>> = {};

/** The connector for a kind of provider. */
export function connectorFor(kind: AiConnectorKind): Connector {
    return replaced[kind] ?? CONNECTORS[kind];
}

/** For tests: answer with these connectors instead, until called again with {}. */
export function replaceConnectorsForTest(connectors: Partial<Record<AiConnectorKind, Connector>>): void {
    replaced = connectors;
}
