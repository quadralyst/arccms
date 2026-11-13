# ArcCMS Scheduled Tasks: Build Spec

**Status:** Spec written 2026-11-13 after a billing review. T1 and T2 built 2026-11-13 on `feat/scheduled-tasks`
(uncommitted); T3 (deploy) not started.
**Branch:** `feat/scheduled-tasks`, cut from `dev`, built in the worktree `../arccms-scheduled-tasks`
(the main checkout stays on `dev` for the running dev server).
**Scope:** replace every scheduled Cloud Function in Arc CMS with one scheduled function,
`scheduledTasks`, that runs a list of tasks on their own timetables. Give apps a plug point to add
their own tasks to that list. Keep kept-warm instances (`minInstances`) at zero in every default
install, and guard that with a test. Make the deploy keep old function images from piling up.

**Why:** Cloud Scheduler charges a flat fee for every scheduled job, about $0.10 (about ₹8.5) a
month, whether it runs once a day or every minute. Only 3 jobs per billing account are free. A
default Arc install deploys 12 scheduled functions, so 12 jobs, and up to 14 with merchant payments
on. In November 2026 Cloud Scheduler was the largest line on the billing account: ₹349 for
Nov 1 to 13, about ₹800 a month, which matches about 8 installs × 12 jobs. One job per install
saves about ₹95 a month per install. The running cost of the tasks themselves does not change.

---

## 0. Decision log

| # | Decision | Choice |
|---|----------|--------|
| T-D1 | One scheduler job per install | A single `onSchedule` function, **`scheduledTasks`** (deployed as `arccms-scheduledTasks`), runs **every minute**. It is the only scheduled function core ships. Every other scheduled function becomes a **task**: a name, a timetable and an async `run()`. |
| T-D2 | The timetable is worked out from the clock, with no stored state | Each run takes the minute it was scheduled for (`event.scheduleTime`, not `Date.now()`, so a run that starts a few seconds late still counts as its minute) and runs every task due in that UTC minute. `every: 5` is due when the minutes since midnight UTC divide by 5. `daily: '02:00'` is due at that minute. `hourly: 0` is due at minute 0 of each hour. No Firestore record of last runs. This matches today exactly: a missed scheduler call skips that run, as it does now, and the next due minute picks the work up. |
| T-D3 | Tasks run side by side and fail alone | The due tasks start together (`Promise.allSettled`). A task that throws is logged with its name and does not stop the others. A task that runs out of memory or time takes that run's other tasks with it; they run at their next due minute. This is the one new failure mode, accepted because every task already picks up leftovers on its next run. |
| T-D4 | Timeout 540 seconds, memory 1GiB | The longest tasks today are `checkAiJobs` and `checkMerchantAccounts` (540 s) and the largest is `checkAiJobs` (1GiB). The tick takes the largest of each so no task gets less than it has today. Billing is per request, so an idle minute costs a fraction of a second: about 43,200 runs a month at about 0.3 s each is under $0.25 a month. |
| T-D5 | Same cadences as today | Every task keeps its current timetable (section 2). With the job fee gone, how often a task runs barely changes the bill, so this build changes no behaviour. Cadence changes are a separate decision. |
| T-D6 | Feature tasks follow feature flags | A feature that is off ships none of its tasks, as today it ships none of its functions. `scripts/arc-features.mjs` already writes `feature-exports.gen.ts`; it also writes **`feature-tasks.gen.ts`**, importing `functions/src/feature-tasks/<id>.ts` for each enabled feature that has one (named like `features/`, so `search+content.ts` needs both). A folder of its own, not `features/<id>.tasks.ts` as first drafted: the generator reads every file in `features/` as a file of function exports. Changed during T1. Always-on tasks live in `functions/src/scheduled/core-tasks.ts`. |
| T-D7 | Tasks are not exports of the `arccms` group | Task lists are never re-exported through `all.ts` or `feature-exports.gen.ts`, so Firebase's deploy discovery only ever sees functions. Only `scheduledTasks` imports them. |
| T-D8 | Apps add tasks, not scheduler jobs | A new starter file, **`functions/src/custom/tasks.ts`**, exports `CUSTOM_TASKS: ArcTask[] = []`. The app kit exports the `ArcTask` and `ArcTimetable` types, and the starter imports them from there, as `custom/ai.ts` does. The tick runs these after core's. App task names are prefixed `custom-` in logs. An app can still export its own `onSchedule` function; the docs say each one costs a scheduler job and recommend a task instead. |
| T-D9 | Every task run leaves a log line | Each task run logs one structured line: `{ arcTask: '<name>', ms, outcome: 'ok' \| 'failed' }`, plus the task's own summary when it returns one. A Logs Explorer filter on `jsonPayload.arcTask` shows how long each task takes. This replaces the per-function view in billing, which a single function can no longer give. |
| T-D10 | Task code stays where it is | Each task's work stays in its current file. The file keeps a plain exported `run` function and loses its `onSchedule` wrapper. Tests call that function directly, as most already call the work inside. |
| T-D11 | Min instances stay at zero by default | Decided 2026-11-13: `ARC_KEEP_WARM` stays, as an opt-in setting that a project sets in its own env file (it is not set in any shipped env file today, and no function sets `minInstances` in code). A new test builds the default function list and fails if any endpoint has `minInstances` above 0. When a project does set `ARC_KEEP_WARM`, every deploy prints which functions are kept warm and that each kept instance is billed all day. |
| T-D12 | The deploy keeps old function images in check | Already built before this spec (2026-10-30): before every deploy that includes functions, `npm run deploy` sets the `gcf-artifacts` cleanup policy (`scripts/arc-artifact-cleanup.mjs`, keep 1 day unless `artifactCleanupDays` says otherwise) and remembers it per project. Found during T2; nothing to build. The November rise on that line needs a look per project in the console (a project deployed without `npm run deploy`, or images in a region the install no longer uses). |
| T-D13 | The old functions are deleted by the normal deploy | The first full functions deploy after this build lists the 12 (or 14) old scheduled functions as removed. `arc-deploy` already asks once before deleting, and deleting a scheduled function deletes its scheduler job. A targeted deploy deletes nothing, so this needs a full functions deploy. |

### Non-goals
Changing any task's cadence · Cloud Tasks or other on-demand triggers for the AI job check or
broadcasts (with one scheduler job per install, these save almost nothing and add a queue to set up
on first deploy) · per-function billing labels (the log lines in T-D9 answer "which task takes
time"; labels are a separate decision) · removing `ARC_KEEP_WARM` (kept opt-in, T-D11) · changes in the
custom space beyond the new empty starter file.

---

## 1. Current state

Scheduled functions, by where they are exported:

| Function | Exported from | Schedule (UTC) | Timeout / memory |
|---|---|---|---|
| `retryPendingEmails` | `all.ts` (always) | every 5 minutes | default |
| `sendAdminDigest` | `all.ts` (always) | every hour, sends only in the configured hour | default |
| `scheduledPurgeEmailLogs` | `all.ts` (always) | every day 02:00 | default |
| `recoverPublishQueue` | `features/content.ts` | every 10 minutes | default |
| `processScheduledBroadcasts` | `features/email-marketing.ts` | every 5 minutes | default |
| `processDripQueue` | `features/email-marketing.ts` | every 15 minutes | default |
| `checkAiJobs` | `features/ai.ts` | every 1 minute | 540 s, 1GiB |
| `cleanUpAi` | `features/ai.ts` | every day 03:15 | default |
| `scanExpiredEntitlements` | `features/payments.ts` | every day 08:00 | default |
| `scanTrialEndings` | `features/payments.ts` | every day 09:00 | default |
| `scanUpdatesEnding` | `features/payments.ts` | every day 09:30 | default |
| `sweepMerchantPayments` | `features/merchant-payments.ts` (off by default) | every 2 minutes | 300 s |
| `checkMerchantAccounts` | `features/merchant-payments.ts` (off by default) | every day 06:00 | 540 s |

`checkAiJobs` has no `timeZone`; every other schedule says UTC. All are the same in the task list.

Related code: `functions/src/load-functions.ts` loads only the file of the function an instance
serves (via `function-map.json`), so the tick's instance loads the tick file and what it imports.
`functions/src/keep-warm.ts` applies `ARC_KEEP_WARM` at deploy. `scripts/arc-deploy.mjs` lists
functions a deploy would delete and asks first.

---

## 2. The task list after the build

| Task | Timetable | Feature |
|---|---|---|
| `checkAiJobs` | `every: 1` | ai |
| `sweepMerchantPayments` | `every: 2` | merchant-payments |
| `retryPendingEmails` | `every: 5` | core |
| `processScheduledBroadcasts` | `every: 5` | email-marketing |
| `recoverPublishQueue` | `every: 10` | content |
| `processDripQueue` | `every: 15` | email-marketing |
| `sendAdminDigest` | `hourly: 0` | core |
| `scheduledPurgeEmailLogs` | `daily: '02:00'` | core |
| `cleanUpAi` | `daily: '03:15'` | ai |
| `checkMerchantAccounts` | `daily: '06:00'` | merchant-payments |
| `scanExpiredEntitlements` | `daily: '08:00'` | payments |
| `scanTrialEndings` | `daily: '09:00'` | payments |
| `scanUpdatesEnding` | `daily: '09:30'` | payments |

Task names stay the same as today's function names, so logs, docs and people's memory carry over.

---

## 3. Design

### 3.1 The task type (`functions/src/scheduled/tasks.ts`)

```ts
export type ArcTimetable =
    | { every: number }      // minutes, dividing 1440 evenly (1, 2, 5, 10, 15, 30, 60, 120 ...)
    | { hourly: number }     // minute of the hour, 0 to 59
    | { daily: string };     // 'HH:MM' UTC

export interface ArcTask {
    name: string;                       // unique; letters, digits, '-'
    when: ArcTimetable;
    run: () => Promise<string | void>;  // an optional one-line summary for the log
}

/** The tasks due in the UTC minute that starts at `at`. */
export function dueTasks(tasks: readonly ArcTask[], at: Date): ArcTask[];

/** Throws on a duplicate name or a timetable that is not valid; called once as the tick loads. */
export function checkTasks(tasks: readonly ArcTask[]): void;
```

`every` must divide 1440 so a cadence never drifts across midnight (1, 2, 3, 4, 5, 6, 8, 10, 12,
15, 20, 30, 60, 120 and so on, up to 1440). `checkTasks` runs in a unit test over the full list, so a bad
timetable fails the suite, not a deploy.

### 3.2 The tick (`functions/src/scheduled/scheduledTasks.ts`)

```ts
export const scheduledTasks = onSchedule(
    { schedule: 'every 1 minutes', timeZone: 'UTC', timeoutSeconds: 540, memory: '1GiB' },
    async (event) => runDue(ALL_TASKS, new Date(event.scheduleTime)),
);
```

`ALL_TASKS` is core's tasks, then `FEATURE_TASKS` from `feature-tasks.gen.ts`, then
`CUSTOM_TASKS`. `runDue` runs the due tasks side by side, times each, logs one line each
(T-D9) and never throws. It is exported for tests.

### 3.3 Feature task files

`functions/src/feature-tasks/ai.ts`, `payments.ts`, `email-marketing.ts`, `content.ts` and
`merchant-payments.ts` each export `TASKS: readonly ArcTask[]`. The full list is put together in
`scheduled/all-tasks.ts` (`ALL_TASKS`), kept apart from `scheduledTasks.ts` so no task list is
ever an export of the `arccms` group.
`scripts/arc-features.mjs` writes `feature-tasks.gen.ts`:

```ts
// Generated from src/custom/features.ts by scripts/arc-features.mjs. Do not edit.
import { TASKS as ai } from './features/ai.tasks.js';
import { TASKS as content } from './features/content.tasks.js';
...
export const FEATURE_TASKS = [...ai, ...content, ...];
```

A test checks that every `feature-tasks/*.ts` file is named after a known feature id, so a misspelt file cannot be silently left out.

### 3.4 App plug point

`functions/src/custom/tasks.ts`, shipped as:

```ts
import type { ArcTask } from '../app-kit/index.js';

/** Your app's own scheduled work. Each runs inside Arc's one scheduled function (docs/app/custom-space.html#scheduled-tasks). */
export const CUSTOM_TASKS: ArcTask[] = [];
```

Its hash goes into `SHIPPED_FILES` in `scripts/custom-starters.mjs`, and the core tests stub it
through the same starter mechanism as the other custom files.

### 3.5 Min instances guard

A test loads the full function list as a deploy does (no `FUNCTION_TARGET`) and applies an empty
keep-warm setting, passing `keepWarmSetting()` an empty environment and a file reader that finds
nothing, so a developer's own `functions/.env.<project>` cannot change the result. It asserts
that no endpoint has `minInstances` above 0. When the setting keeps any, the deploy's
output says: `ARC_KEEP_WARM keeps instances running, each billed all day whether it is used or not: signInWithPin ×1.`

### 3.6 Artifact cleanup in the deploy

Already in place: `scripts/arc-artifact-cleanup.mjs` (T-D12).

---

## 4. Phases

Three phases: two to build, one to deploy. Each build phase ends with its own critical review:
correctness, failure cases, tests, docs drift, and anything that differs from this spec, with
every critical, high and medium finding fixed before the next phase.

**T1. One scheduler job (the runner, every task, the app plug point).**
- `scheduled/tasks.ts` (`ArcTask`, `dueTasks`, `checkTasks`) and `scheduled/scheduledTasks.ts`
  with `runDue`.
- Each of the 13 functions in section 2 loses its `onSchedule` wrapper and keeps an exported
  `run`. Core tasks go in `scheduled/core-tasks.ts`, feature tasks in `features/<id>.tasks.ts`,
  and the feature exports stop exporting the old functions. `arc-features.mjs` writes
  `feature-tasks.gen.ts`.
- `functions/src/custom/tasks.ts` starter, its `SHIPPED_FILES` hash and the custom-starters stub.
- Tests: due minutes for each timetable kind, midnight and the hour boundary; a late-starting
  run uses `scheduleTime`; one task throwing does not stop the others; one log line per task;
  duplicate names and bad timetables rejected; the full task list passes `checkTasks` and
  matches section 2 exactly; a feature turned off drops its tasks; a custom task runs after
  core's with the `custom-` prefix in its log line. Existing specs that call `.run()` on a
  scheduled function call the plain function instead.
- Critical review.

**T2. Deploy safeguards and docs.**
- The default `minInstances` test and the kept-warm notice. The notice is printed by
  `functions/src/index.ts` while a deploy reads the functions (where `ARC_KEEP_WARM` is
  applied), so every deploy shows it, not only `npm run deploy`. The artifact cleanup step
  was already built (T-D12).
- Docs. `npm run docs:affected` will list most of these; expected pages:
  `docs/reference/cloud-functions.html` (one scheduled function and the task table, in place of
  the scheduled rows in each section), `docs/operations/deploy.html` (the first deploy deletes
  the old scheduled functions; artifact cleanup; kept-warm line), `docs/app/custom-space.html`
  (scheduled tasks plug point; why not `onSchedule`), `docs/app/functions.html` (kept warm
  costs), and the feature pages that name a schedule: `features/ai.html`, `features/email.html`,
  `features/email-marketing.html`, `features/payments.html`, `features/entitlements.html`,
  `features/content.html`, `app/ai.html`, `app/merchant-payments.html`,
  `reference/feature-ids.html`. A short section on reading the task log lines (T-D9) goes in
  `docs/operations/troubleshooting.html`.
- `npm run gate`, then a critical review of the whole build.

**T3. Deploy and check (by hand, with the project owner).** Full functions deploy to the xlm
project from the main checkout after merge, never from the worktree (the worktree has no
`functions/.env.<project>`). Confirm the deploy lists the old scheduled functions for deletion,
and after it: Cloud Scheduler shows one `arccms` job; logs show `arcTask` lines at the expected
minutes; a scheduled broadcast, a retried email and the admin digest still go out. Then the same
deploy on the other installs.

---

## 5. Risks

| Risk | Handling |
|---|---|
| One task's crash (out of memory, timeout) ends that minute's other tasks | Accepted (T-D3). Every task already resumes from Firestore state next run. The 1GiB / 540 s limits are today's largest. |
| A long task overlaps the next minute's run | Same as today: Cloud Scheduler already starts a run whether or not the last one ended. The AI job check claims each job; the others work from status fields. No new overlap is introduced, because each task still only starts at its own due minutes. |
| During the first deploy, old and new functions both run for a short while | The deploy creates the tick before deleting the old functions, so a task may run twice in one minute. Every task already tolerates overlap (row above). |
| Billing no longer splits scheduled work by function | T-D9 log lines give each task's time. |
| An app has its own `onSchedule` functions | Untouched; the docs explain the per-job fee and how to move them into `CUSTOM_TASKS`. |

---

## 6. Cost check

| | Before | After |
|---|---|---|
| Scheduler jobs per default install | 12 (14 with merchant payments) | 1 |
| Scheduler fee per install per month | about ₹100 (minus the 3 free per billing account) | about ₹8.5 |
| Function runs per month from schedules | about 68,500 (about 90,000 with merchant payments), the per-minute AI check most of it | 43,200 |
| Function CPU and memory | unchanged in practice: the same work runs, idle minutes are fractions of a second |

---

## 7. Open questions

1. **Other projects on the billing account** that are not Arc installs are out of scope. Their scheduler jobs, App Engine charges and Hosting
   release storage need a look in the console; this build does not touch them.
