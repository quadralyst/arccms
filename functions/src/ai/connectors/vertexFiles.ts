/**
 * What the Vertex connection makes besides text (specs/ai-media-spec.md, AM-D7): speech
 * through Cloud Text-to-Speech (AM2) and pictures through Gemini's picture models (AM3), all
 * with the functions' own service account.
 */
import { vertexImages } from './geminiImages.js';
import { googleTtsSpeech, googleTtsVoices } from './googleTts.js';
import type { FileConnector, FileProvider } from './types.js';

const make: FileConnector = async (context, request) => (request.kind === 'image' ? vertexImages(context, request) : googleTtsSpeech(context, request));

export const vertexFileProvider: FileProvider = { make, voices: googleTtsVoices };
