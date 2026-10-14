import { onSchedule } from 'firebase-functions/v2/scheduler';
import { recoverStaleCoalesced, STALE_MS } from './coalesced-items.js';

/**
 * Every 10 minutes, runs again a whole-site republish or an items-from rebuild
 * whose run never finished (coalesced-items.ts). Such an item stays `running`
 * for STALE_MS; requests meanwhile only mark it `dirty`, and without this
 * nothing would run that work when no further change comes in. Each one found
 * counts as a failed run, so an item that keeps dying stops after
 * MAX_FAILED_RUNS.
 */
export const recoverPublishQueue = onSchedule({ schedule: 'every 10 minutes', timeZone: 'UTC' }, async () => {
    const recovered = await recoverStaleCoalesced();
    if (recovered.length) {
        console.warn(`Ran again ${recovered.length} queue item(s) older than ${STALE_MS / 60000} minutes: ${recovered.join(', ')}`);
    }
});
