/**
 * Every minute: how each long job is doing (specs/ai-media-spec.md, AM-D12, AM-D13; jobs.ts).
 * One query when no job is pending, so it costs almost nothing while there are none. A
 * finished job's file is streamed into Storage, its record and the month's totals are brought
 * up to date, and the purpose's onJobDone runs.
 */
import { checkJobs } from '../jobs.js';

export async function checkAiJobs(): Promise<void> {
    const { looked, ended } = await checkJobs();
    if (looked) console.log(`checkAiJobs: ${looked} pending, ${ended} ended`);
}
