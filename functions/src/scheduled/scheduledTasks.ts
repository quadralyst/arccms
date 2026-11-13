/**
 * The one scheduled function (scheduled/tasks.ts, specs/scheduled-tasks-spec.md): every
 * minute, the tasks due in that minute. Its limits are the largest any task needs, as each
 * had them when it was a scheduled function of its own: 540 seconds (checkAiJobs,
 * checkMerchantAccounts) and 1GiB (checkAiJobs). Billing is per run, so an idle minute
 * costs a fraction of a second.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ALL_TASKS } from './all-tasks.js';
import { minuteOf, runDue } from './tasks.js';

export const scheduledTasks = onSchedule(
    { schedule: 'every 1 minutes', timeZone: 'UTC', timeoutSeconds: 540, memory: '1GiB' },
    async (event) => {
        await runDue(ALL_TASKS, minuteOf(event.scheduleTime));
    },
);
