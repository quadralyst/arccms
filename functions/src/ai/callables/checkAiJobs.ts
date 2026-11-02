/**
 * Every minute: how each long job is doing (specs/ai-media-spec.md, AM-D12, AM-D13; jobs.ts).
 * One query when no job is pending, so it costs almost nothing while there are none. A
 * finished job's file is streamed into Storage, its record and the month's totals are brought
 * up to date, and the purpose's onJobDone runs.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { checkJobs } from '../jobs.js';

export const checkAiJobs = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 540, memory: '1GiB' }, async () => {
    const { looked, ended } = await checkJobs();
    if (looked) console.log(`checkAiJobs: ${looked} pending, ${ended} ended`);
});
