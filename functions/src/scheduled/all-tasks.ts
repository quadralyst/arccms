/**
 * Every scheduled task this install runs: core's, those of the features it has, then the
 * app's own (functions/src/custom/tasks.ts). Checked as it loads, so a mistake in a task
 * stops the functions from loading and the deploy fails with the reason.
 *
 * Kept apart from scheduledTasks.ts, which all.ts exports: a task list must never be an
 * export of the `arccms` group, where the deploy would read it as functions.
 */
import { CUSTOM_TASKS } from '../custom/tasks.js';
import { FEATURE_TASKS } from '../feature-tasks.gen.js';
import { CORE_TASKS } from './core-tasks.js';
import { allTasks } from './tasks.js';

export const ALL_TASKS = allTasks(CORE_TASKS, FEATURE_TASKS, CUSTOM_TASKS);
