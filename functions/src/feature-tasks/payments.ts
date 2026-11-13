/**
 * The payments feature's scheduled tasks (scheduled/tasks.ts). Run only when the app has
 * the feature: functions/src/feature-tasks.gen.ts lists this file.
 */
import { scanExpiredEntitlements } from '../dodo-payments/scanExpiredEntitlements.js';
import { scanTrialEndings } from '../dodo-payments/scanTrialEndings.js';
import { scanUpdatesEnding } from '../dodo-payments/scanUpdatesEnding.js';
import type { ArcTask } from '../scheduled/tasks.js';

export const TASKS: readonly ArcTask[] = [
    { name: 'scanExpiredEntitlements', when: { daily: '08:00' }, run: scanExpiredEntitlements },
    { name: 'scanTrialEndings', when: { daily: '09:00' }, run: scanTrialEndings },
    { name: 'scanUpdatesEnding', when: { daily: '09:30' }, run: scanUpdatesEnding },
];
