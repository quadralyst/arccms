/**
 * The email-marketing feature's scheduled tasks (scheduled/tasks.ts). Run only when the
 * app has the feature: functions/src/feature-tasks.gen.ts lists this file.
 */
import { processDripQueue } from '../email-core/processDripQueue.js';
import { processScheduledBroadcasts } from '../email-log/processScheduledBroadcasts.js';
import type { ArcTask } from '../scheduled/tasks.js';

export const TASKS: readonly ArcTask[] = [
    { name: 'processScheduledBroadcasts', when: { every: 5 }, run: processScheduledBroadcasts },
    { name: 'processDripQueue', when: { every: 15 }, run: processDripQueue },
];
