/**
 * The app's own scheduled tasks (docs/app/custom-space.html#scheduled-tasks). Arc CMS
 * ships this empty and never edits it again.
 *
 * Each task runs inside Arc CMS's one scheduled function, on its own timetable in UTC:
 * `{ every: 15 }` minutes, `{ hourly: 0 }` or `{ daily: '04:30' }`. A scheduled function
 * of the app's own would cost a Cloud Scheduler job of its own; a task costs nothing more.
 * A mistake here stops the functions from loading, so the deploy fails with the reason.
 */
import type { ArcTask } from '../app-kit/index.js';

export const CUSTOM_TASKS: ArcTask[] = [];
