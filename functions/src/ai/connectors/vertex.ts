import type { Connector } from './types.js';

/** Google Vertex AI for Gemini: built in phase AI5 (specs/ai-spec.md). */
export const vertexConnector: Connector = async ({ connection }) => ({
    ok: false,
    failure: 'off',
    detail: `connection ${connection.id}: the Vertex connector is not available yet`,
});
