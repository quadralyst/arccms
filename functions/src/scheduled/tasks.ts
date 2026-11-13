/**
 * Scheduled tasks (specs/scheduled-tasks-spec.md, docs/reference/cloud-functions.html).
 *
 * Cloud Scheduler charges for every scheduled job, however often it runs, so Arc CMS has
 * one: `scheduledTasks`, every minute. Each piece of scheduled work is a task with its own
 * timetable, and each run starts the tasks due in its minute. Which tasks are due comes
 * from the clock alone, with nothing stored: a run that never happens skips that minute's
 * tasks, as a missed scheduler job always has, and each task picks up what is left the
 * next time it is due.
 */
import { logger } from 'firebase-functions/v2';

/** When a task runs, always in UTC. */
export type ArcTimetable =
    /** Every so many minutes from midnight; must divide a day (1, 2, 5, 10, 15, 30, 60, 120 ...). */
    | { every: number }
    /** Once an hour, at this minute (0 to 59). */
    | { hourly: number }
    /** Once a day, at this time, 'HH:MM'. */
    | { daily: string };

export interface ArcTask {
    /** Unique; letters, digits, '-' and '_', starting with a letter. Its log lines carry it. */
    name: string;
    when: ArcTimetable;
    /** The work. A one-line summary it returns goes in its log line. */
    run: () => Promise<string | void>;
}

/** How one task's run ended, as its log line says. */
export interface TaskOutcome {
    name: string;
    outcome: 'ok' | 'failed';
    ms: number;
}

const MINUTES_PER_DAY = 1440;
const NAME = /^[A-Za-z][\w-]*$/;
const DAILY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Why a timetable cannot be used, or null when it can. */
function timetableProblem(when: ArcTimetable): string | null {
    const keys = when && typeof when === 'object' ? Object.keys(when) : [];
    if (keys.length !== 1) return 'needs exactly one of every, hourly or daily';
    if ('every' in when) {
        const n = when.every;
        return Number.isInteger(n) && n >= 1 && n <= MINUTES_PER_DAY && MINUTES_PER_DAY % n === 0
            ? null
            : `every: ${String(n)} is not a whole number of minutes that divides a day (1, 2, 5, 10, 15, 30, 60 ...)`;
    }
    if ('hourly' in when) {
        const m = when.hourly;
        return Number.isInteger(m) && m >= 0 && m <= 59 ? null : `hourly: ${String(m)} is not a minute from 0 to 59`;
    }
    if ('daily' in when) return typeof when.daily === 'string' && DAILY.test(when.daily) ? null : `daily: '${String(when.daily)}' is not a time 'HH:MM'`;
    return `${keys[0]} is not a timetable: use every, hourly or daily`;
}

/** Throws, naming each mistake, on a name that is used twice or not allowed, or a timetable that cannot be used. */
export function checkTasks(tasks: readonly ArcTask[]): void {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const task of tasks) {
        const name = String(task?.name);
        if (!NAME.test(name)) problems.push(`"${name}" is not a task name: letters, digits, '-' and '_', starting with a letter`);
        else if (seen.has(name)) problems.push(`"${name}" is the name of two tasks`);
        seen.add(name);
        if (typeof task?.run !== 'function') problems.push(`"${name}" has no run function`);
        const problem = timetableProblem(task?.when);
        if (problem) problems.push(`"${name}": ${problem}`);
    }
    if (problems.length) throw new Error(`Scheduled tasks: ${problems.join('; ')}.`);
}

/** The start of the UTC minute a run is for: the time it was scheduled, or now when that cannot be read. */
export function minuteOf(scheduleTime: string | undefined, now = Date.now()): Date {
    const at = scheduleTime ? Date.parse(scheduleTime) : NaN;
    const ms = Number.isFinite(at) ? at : now;
    return new Date(Math.floor(ms / 60_000) * 60_000);
}

/** Whether a timetable is due in the UTC minute that starts at `at`. */
export function isDue(when: ArcTimetable, at: Date): boolean {
    const hour = at.getUTCHours();
    const minute = at.getUTCMinutes();
    if ('every' in when) return (hour * 60 + minute) % when.every === 0;
    if ('hourly' in when) return minute === when.hourly;
    const [h, m] = when.daily.split(':').map(Number);
    return hour === h && minute === m;
}

/** The tasks due in the UTC minute that starts at `at`, in the list's order. */
export function dueTasks(tasks: readonly ArcTask[], at: Date): ArcTask[] {
    return tasks.filter((task) => isDue(task.when, at));
}

type Log = Pick<typeof logger, 'info' | 'error'>;

/**
 * Starts every task due at `at` together and waits for them all. A task that throws is
 * logged and the others carry on; nothing here throws. Each task leaves one log line
 * whose `arcTask`, `ms` and `outcome` fields say how it went, so the time each task takes
 * can be read in Logs Explorer (`jsonPayload.arcTask="cleanUpAi"`).
 */
export async function runDue(tasks: readonly ArcTask[], at: Date, log: Log = logger): Promise<TaskOutcome[]> {
    const due = dueTasks(tasks, at);
    return Promise.all(due.map(async (task): Promise<TaskOutcome> => {
        const started = Date.now();
        try {
            const summary = await task.run();
            const ms = Date.now() - started;
            log.info(`${task.name}: done in ${ms} ms${summary ? `: ${summary}` : ''}`, { arcTask: task.name, ms, outcome: 'ok', ...(summary ? { summary } : {}) });
            return { name: task.name, outcome: 'ok', ms };
        } catch (err) {
            const ms = Date.now() - started;
            const error = err instanceof Error ? err.message : String(err);
            // The stack, so Error Reporting groups it and the line says where it broke.
            const stack = err instanceof Error ? err.stack : undefined;
            log.error(`${task.name}: failed after ${ms} ms: ${error}`, { arcTask: task.name, ms, outcome: 'failed', error, ...(stack ? { stack } : {}) });
            return { name: task.name, outcome: 'failed', ms };
        }
    }));
}

/**
 * Core's, the features' and the app's tasks as one checked list. The app's are named
 * `custom-<name>` in it, so they never clash with core's and their log lines say whose
 * they are.
 */
export function allTasks(core: readonly ArcTask[], features: readonly ArcTask[], custom: readonly ArcTask[]): readonly ArcTask[] {
    const list = [...core, ...features, ...custom.map((task) => ({ ...task, name: `custom-${String(task?.name)}` }))];
    checkTasks(list);
    return list;
}
