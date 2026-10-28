/**
 * The app's AI purposes (docs/app/ai.html). Arc CMS ships this empty and never edits
 * it again.
 *
 * Each purpose says what one use of AI is: what it takes, the instruction, the shape of
 * the answer, its tier and a test answer. The app's functions call askAi with the
 * purpose's id and the input; which models answer, the keys and the limits are set in
 * Settings, AI. A mistake here stops the functions from loading, so the deploy fails
 * with the reason.
 */
import type { AiPurposes } from '../app-kit/index.js';

export const AI_PURPOSES: AiPurposes = {};
