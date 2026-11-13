/**
 * The ai feature's scheduled tasks (scheduled/tasks.ts). Run only when the app has the
 * feature: functions/src/feature-tasks.gen.ts lists this file.
 */
import { checkAiJobs } from '../ai/callables/checkAiJobs.js';
import { cleanUpAi } from '../ai/callables/cleanUpAi.js';
import type { ArcTask } from '../scheduled/tasks.js';

export const TASKS: readonly ArcTask[] = [
    // How each long job (a video being made) is doing; one query when none is pending.
    { name: 'checkAiJobs', when: { every: 1 }, run: checkAiJobs },
    { name: 'cleanUpAi', when: { daily: '03:15' }, run: cleanUpAi },
];
