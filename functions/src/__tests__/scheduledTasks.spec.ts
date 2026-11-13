/**
 * Scheduled tasks (functions/src/scheduled, specs/scheduled-tasks-spec.md): which tasks are
 * due in a minute, a task failing alone, the one scheduled function, and the task list
 * itself matching the timetables each scheduled function had before.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const { onScheduleMock } = vi.hoisted(() => ({
    onScheduleMock: vi.fn((opts: unknown, handler: (event: { scheduleTime?: string }) => Promise<void>) => Object.assign(handler, { opts })),
}));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: onScheduleMock }));

const tickRuns = vi.hoisted(() => [] as string[]);
vi.mock('../scheduled/all-tasks.js', () => ({
    ALL_TASKS: [
        { name: 'everyFive', when: { every: 5 }, run: async () => { tickRuns.push('everyFive'); } },
        { name: 'nineThirty', when: { daily: '09:30' }, run: async () => { tickRuns.push('nineThirty'); } },
    ],
}));

import { CORE_TASKS } from '../scheduled/core-tasks.js';
import { allTasks, checkTasks, dueTasks, isDue, minuteOf, runDue, type ArcTask } from '../scheduled/tasks.js';
import { scheduledTasks } from '../scheduled/scheduledTasks.js';
import { FEATURE_IDS } from '../feature-flags.js';
import { TASKS as AI } from '../feature-tasks/ai.js';
import { TASKS as CONTENT } from '../feature-tasks/content.js';
import { TASKS as EMAIL_MARKETING } from '../feature-tasks/email-marketing.js';
import { TASKS as MERCHANT_PAYMENTS } from '../feature-tasks/merchant-payments.js';
import { TASKS as PAYMENTS } from '../feature-tasks/payments.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (hhmm: string) => new Date(`2026-11-13T${hhmm}:00.000Z`);
const task = (name: string, when: ArcTask['when'], run: ArcTask['run'] = async () => undefined): ArcTask => ({ name, when, run });
const quietLog = () => ({ info: vi.fn(), error: vi.fn() });

describe('which tasks are due', () => {
    it('every n minutes counts from midnight UTC', () => {
        expect(isDue({ every: 5 }, at('00:00'))).toBe(true);
        expect(isDue({ every: 5 }, at('10:35'))).toBe(true);
        expect(isDue({ every: 5 }, at('10:33'))).toBe(false);
        expect(isDue({ every: 15 }, at('23:45'))).toBe(true);
        expect(isDue({ every: 120 }, at('02:00'))).toBe(true);
        expect(isDue({ every: 120 }, at('03:00'))).toBe(false);
        expect(isDue({ every: 1 }, at('07:13'))).toBe(true);
    });

    it('hourly runs at its minute of every hour', () => {
        expect(isDue({ hourly: 0 }, at('13:00'))).toBe(true);
        expect(isDue({ hourly: 0 }, at('13:01'))).toBe(false);
        expect(isDue({ hourly: 30 }, at('00:30'))).toBe(true);
    });

    it('daily runs once, at its time in UTC', () => {
        expect(isDue({ daily: '09:30' }, at('09:30'))).toBe(true);
        expect(isDue({ daily: '09:30' }, at('21:30'))).toBe(false);
        expect(isDue({ daily: '00:00' }, at('00:00'))).toBe(true);
    });

    it('lists the due tasks in the list\'s order', () => {
        const tasks = [task('a', { every: 10 }), task('b', { daily: '02:00' }), task('c', { hourly: 5 })];
        expect(dueTasks(tasks, at('02:00')).map((t) => t.name)).toEqual(['a', 'b']);
        expect(dueTasks(tasks, at('02:05')).map((t) => t.name)).toEqual(['c']);
    });

    it('takes the minute a run was scheduled for, not when it started', () => {
        expect(minuteOf('2026-11-13T09:29:59.900Z').toISOString()).toBe('2026-11-13T09:29:00.000Z');
        expect(minuteOf('2026-11-13T09:30:04.512Z').toISOString()).toBe('2026-11-13T09:30:00.000Z');
        const now = Date.parse('2026-11-13T10:00:42Z');
        expect(minuteOf(undefined, now).toISOString()).toBe('2026-11-13T10:00:00.000Z');
        expect(minuteOf('not a time', now).toISOString()).toBe('2026-11-13T10:00:00.000Z');
    });
});

describe('checking the list', () => {
    it('accepts good tasks', () => {
        expect(() => checkTasks([task('a', { every: 1 }), task('b-2', { hourly: 59 }), task('c_3', { daily: '23:59' })])).not.toThrow();
    });

    it.each([
        ['a name used twice', [task('a', { every: 5 }), task('a', { every: 10 })], /"a" is the name of two tasks/],
        ['a name not allowed', [task('2fast', { every: 5 })], /not a task name/],
        ['every that does not divide a day', [task('a', { every: 7 })], /every: 7/],
        ['every of zero', [task('a', { every: 0 })], /every: 0/],
        ['every not whole', [task('a', { every: 1.5 })], /every: 1.5/],
        ['hourly past 59', [task('a', { hourly: 60 })], /hourly: 60/],
        ['daily without a leading zero', [task('a', { daily: '9:30' })], /daily: '9:30'/],
        ['daily at 24:00', [task('a', { daily: '24:00' })], /daily: '24:00'/],
        ['two timetables', [task('a', { every: 5, hourly: 0 } as unknown as ArcTask['when'])], /exactly one/],
        ['no run', [{ name: 'a', when: { every: 5 } } as unknown as ArcTask], /no run function/],
    ])('refuses %s', (_label, tasks, message) => {
        expect(() => checkTasks(tasks as ArcTask[])).toThrow(message);
    });

    it('names the app\'s tasks custom-<name>, after core\'s and the features\'', () => {
        const list = allTasks([task('core', { every: 5 })], [task('feature', { every: 5 })], [task('core', { every: 5 })]);
        expect(list.map((t) => t.name)).toEqual(['core', 'feature', 'custom-core']);
    });

    it('stops the functions loading on a mistake in the app\'s tasks', () => {
        expect(() => allTasks([], [], [task('a', { every: 7 })])).toThrow(/"custom-a": every: 7/);
    });
});

describe('running the due tasks', () => {
    it('runs only the due ones, side by side, and logs one line each', async () => {
        const order: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const tasks = [
            task('slow', { every: 5 }, async () => { order.push('slow start'); await gate; order.push('slow end'); }),
            task('quick', { every: 5 }, async () => { order.push('quick'); release(); return '3 sent'; }),
            task('later', { daily: '23:00' }, async () => { order.push('later'); }),
        ];
        const log = quietLog();
        const outcomes = await runDue(tasks, at('10:05'), log);
        expect(order).toEqual(['slow start', 'quick', 'slow end']);
        expect(outcomes.map((o) => [o.name, o.outcome])).toEqual([['slow', 'ok'], ['quick', 'ok']]);
        expect(log.info).toHaveBeenCalledTimes(2);
        expect(log.info).toHaveBeenCalledWith(expect.stringContaining('quick: done in'), expect.objectContaining({ arcTask: 'quick', outcome: 'ok', summary: '3 sent' }));
        expect(log.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ arcTask: 'slow', outcome: 'ok', ms: expect.any(Number) }));
    });

    it('logs a task that throws and still runs the others, never throwing itself', async () => {
        const ran: string[] = [];
        const tasks = [
            task('broken', { every: 1 }, async () => { throw new Error('quota read failed'); }),
            task('fine', { every: 1 }, async () => { ran.push('fine'); }),
        ];
        const log = quietLog();
        const outcomes = await runDue(tasks, at('04:04'), log);
        expect(ran).toEqual(['fine']);
        expect(outcomes).toEqual([
            expect.objectContaining({ name: 'broken', outcome: 'failed' }),
            expect.objectContaining({ name: 'fine', outcome: 'ok' }),
        ]);
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining('quota read failed'), expect.objectContaining({ arcTask: 'broken', outcome: 'failed', error: 'quota read failed', stack: expect.stringContaining('quota read failed') }));
    });

    it('does nothing in a minute with no task due', async () => {
        const log = quietLog();
        expect(await runDue([task('a', { daily: '02:00' })], at('02:01'), log)).toEqual([]);
        expect(log.info).not.toHaveBeenCalled();
    });
});

describe('the one scheduled function', () => {
    it('runs every minute in UTC with the largest limits any task had', () => {
        expect((scheduledTasks as unknown as { opts: unknown }).opts).toEqual({ schedule: 'every 1 minutes', timeZone: 'UTC', timeoutSeconds: 540, memory: '1GiB' });
    });

    it('runs the tasks due in the minute it was scheduled for', async () => {
        tickRuns.length = 0;
        const run = scheduledTasks as unknown as (event: { scheduleTime?: string }) => Promise<void>;
        await run({ scheduleTime: '2026-11-13T09:30:03.120Z' });
        expect(tickRuns.sort()).toEqual(['everyFive', 'nineThirty']);
        tickRuns.length = 0;
        await run({ scheduleTime: '2026-11-13T09:31:00.000Z' });
        expect(tickRuns).toEqual([]);
    });

    it('is the only scheduled function in core: everything else is a task', () => {
        const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]);
        const scheduling = walk(SRC)
            .filter((f) => f.endsWith('.ts') && !/\/(__tests__|custom)\/|\.spec\.ts$/.test(f))
            .filter((f) => readFileSync(f, 'utf8').includes('onSchedule('))
            .map((f) => f.slice(SRC.length + 1));
        expect(scheduling).toEqual(['scheduled/scheduledTasks.ts']);
    });

    it('is exported from all.ts, and no task list is', () => {
        const all = readFileSync(resolve(SRC, 'all.ts'), 'utf8');
        expect(all).toContain("export * from './scheduled/scheduledTasks.js';");
        const exporters = ['all.ts', ...readdirSync(resolve(SRC, 'features')).map((f) => `features/${f}`)];
        for (const file of exporters) {
            expect(readFileSync(resolve(SRC, file), 'utf8'), file).not.toMatch(/from '\.\.?\/(feature-tasks|scheduled\/(all-tasks|core-tasks|tasks))/);
        }
        expect(readFileSync(resolve(SRC, 'scheduled/scheduledTasks.ts'), 'utf8')).not.toMatch(/export const (?!scheduledTasks)/);
    });
});

describe('the task list', () => {
    const FEATURES: Record<string, readonly ArcTask[]> = {
        ai: AI, content: CONTENT, 'email-marketing': EMAIL_MARKETING, 'merchant-payments': MERCHANT_PAYMENTS, payments: PAYMENTS,
    };

    it('keeps the timetable each scheduled function had (specs/scheduled-tasks-spec.md, section 2)', () => {
        const timetables = (tasks: readonly ArcTask[]) => Object.fromEntries(tasks.map((t) => [t.name, t.when]));
        expect(timetables(CORE_TASKS)).toEqual({
            retryPendingEmails: { every: 5 },
            sendAdminDigest: { hourly: 0 },
            scheduledPurgeEmailLogs: { daily: '02:00' },
        });
        expect(Object.fromEntries(Object.entries(FEATURES).map(([id, tasks]) => [id, timetables(tasks)]))).toEqual({
            ai: { checkAiJobs: { every: 1 }, cleanUpAi: { daily: '03:15' } },
            content: { recoverPublishQueue: { every: 10 } },
            'email-marketing': { processScheduledBroadcasts: { every: 5 }, processDripQueue: { every: 15 } },
            'merchant-payments': { sweepMerchantPayments: { every: 2 }, checkMerchantAccounts: { daily: '06:00' } },
            payments: { scanExpiredEntitlements: { daily: '08:00' }, scanTrialEndings: { daily: '09:00' }, scanUpdatesEnding: { daily: '09:30' } },
        });
        expect(() => checkTasks([...CORE_TASKS, ...Object.values(FEATURES).flat()])).not.toThrow();
    });

    it('has one feature-tasks file per feature, or per set joined with +, named after them', () => {
        const files = readdirSync(resolve(SRC, 'feature-tasks')).map((f) => f.replace(/\.ts$/, ''));
        expect(files.sort()).toEqual(Object.keys(FEATURES).sort());
        for (const file of files) for (const id of file.split('+')) expect(FEATURE_IDS).toContain(id);
    });

    it('is the task table on docs/reference/cloud-functions.html, with the same timetables', () => {
        const page = readFileSync(resolve(SRC, '../../docs/reference/cloud-functions.html'), 'utf8');
        const start = page.indexOf('<th>When</th><th>Task</th>');
        const table = page.slice(start, page.indexOf('</table>', start));
        const words = (when: ArcTask['when']) => 'every' in when
            ? (when.every === 1 ? 'Every minute' : `Every ${when.every} minutes`)
            : 'hourly' in when ? 'Every hour, on the hour' : `Daily, ${when.daily}`;
        const documented = [...table.matchAll(/<tr><td>([^<]+)<\/td><td><code>(\w+)<\/code><\/td>/g)].map((m) => `${m[2]}: ${m[1]}`).sort();
        const code = [...CORE_TASKS, ...Object.values(FEATURES).flat()].map((t) => `${t.name}: ${words(t.when)}`).sort();
        expect(documented).toEqual(code);
    });

    it('runs each task as the plain function its file exports', async () => {
        const { retryPendingEmails } = await import('../email-core/retryPendingEmails.js');
        expect(CORE_TASKS.find((t) => t.name === 'retryPendingEmails')?.run).toBe(retryPendingEmails);
        for (const t of [...CORE_TASKS, ...Object.values(FEATURES).flat()]) expect(typeof t.run, t.name).toBe('function');
    });
});
