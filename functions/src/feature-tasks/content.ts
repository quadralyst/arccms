/**
 * The content feature's scheduled tasks (scheduled/tasks.ts). Run only when the app has
 * the feature: functions/src/feature-tasks.gen.ts lists this file.
 */
import { recoverPublishQueue } from '../publishQueue/recoverPublishQueue.js';
import type { ArcTask } from '../scheduled/tasks.js';

export const TASKS: readonly ArcTask[] = [
    // Runs again a whole-site republish or items-from rebuild whose run never finished.
    { name: 'recoverPublishQueue', when: { every: 10 }, run: recoverPublishQueue },
];
