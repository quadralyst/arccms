/**
 * The merchant-payments feature's scheduled tasks (scheduled/tasks.ts). Run only when the
 * app has the feature: functions/src/feature-tasks.gen.ts lists this file.
 */
import { checkMerchantAccounts } from '../merchant-payments/checkAccounts.js';
import { sweepMerchantPayments } from '../merchant-payments/sweep.js';
import type { ArcTask } from '../scheduled/tasks.js';

export const TASKS: readonly ArcTask[] = [
    // Payments due a read, and results the app has not taken yet: a missed webhook recovers with no browser.
    { name: 'sweepMerchantPayments', when: { every: 2 }, run: sweepMerchantPayments },
    { name: 'checkMerchantAccounts', when: { daily: '06:00' }, run: checkMerchantAccounts },
];
