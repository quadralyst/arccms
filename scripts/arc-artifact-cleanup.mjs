/**
 * The cleanup policy of the functions' container images (docs/operations/deploy.html,
 * "Old function images").
 *
 * Every function build leaves a container image in the Artifact Registry repository
 * `gcf-artifacts` in the functions region, and Google bills for the space they take.
 * A functions deploy with no policy on that repository stops at a Firebase CLI number
 * prompt, which showed with no question text inside `npm run deploy` (a bare `>`, found
 * 2026-10-30); off a terminal the CLI fails the deploy instead, after the functions are
 * live. So before a deploy that includes functions this sets the policy itself:
 * `firebase functions:artifacts:setpolicy`, keeping images for the project's
 * `artifactCleanupDays` (default 1), or `none` to opt out, which the CLI respects too.
 *
 * The repository appears only when a project's first function is built, so on a first
 * deploy it is missing: then the policy is set while the deploy runs, as soon as the
 * repository exists (watchForRepository). Functions take minutes to create after their
 * build, so it is in place before the CLI checks. A first try that fails is retried the
 * same way: on a new project, Artifact Registry may have been turned on seconds before. What was set is remembered in
 * .arc-deploy-state.json (`artifactCleanup`), so a later deploy does not ask Google again.
 */
import { spawn } from 'node:child_process';

export const DEFAULT_ARTIFACT_CLEANUP_DAYS = 1;
/** How often a first deploy looks for the repository while the functions are created. */
export const REPOSITORY_POLL_MS = 15_000;

/** A project's setting from arccms.config.json: a number of days, or 'none'. */
export function cleanupSetting(config) {
    const value = String(config?.artifactCleanupDays ?? '').trim();
    if (value === 'none') return 'none';
    return /^[1-9][0-9]*$/.test(value) ? Number(value) : DEFAULT_ARTIFACT_CLEANUP_DAYS;
}

/** The `firebase` arguments that set the policy, with no question asked. */
export function setPolicyArgs(projectId, region, setting) {
    const keep = setting === 'none' ? ['--none'] : ['--days', String(setting)];
    return ['functions:artifacts:setpolicy', '--location', region, ...keep, '--force', '--project', projectId];
}

/**
 * What a setpolicy run did: 'set' (or already set), 'missing' when the repository does
 * not exist yet (the CLI says so and exits 0), or 'failed'.
 */
export function policyResult(status, output) {
    if (/does not exist in Artifact Registry/.test(output)) return 'missing';
    return status === 0 ? 'set' : 'failed';
}

/** The remembered value for a region and setting, such as `us-east1:1`. */
export function policyKey(region, setting) {
    return `${region}:${setting}`;
}

/** Whether this policy was set for the project before. */
export function rememberedPolicy(state, projectId, region, setting) {
    return state?.artifactCleanup?.[projectId] === policyKey(region, setting);
}

/** The state with this policy remembered for the project. */
export function rememberPolicy(state, projectId, region, setting) {
    return { ...state, artifactCleanup: { ...state?.artifactCleanup, [projectId]: policyKey(region, setting) } };
}

/** The state without the project's remembered policy, so the next deploy sets it again. */
export function forgetPolicy(state, projectId) {
    const { [projectId]: _gone, ...rest } = state?.artifactCleanup ?? {};
    return { ...state, artifactCleanup: rest };
}

/** Whether the Firebase CLI found no policy during a deploy (it then asks, or fails off a terminal). */
export function cliFoundNoPolicy(output) {
    return /No cleanup policy detected/.test(output);
}

/** The command a person runs to set the policy by hand. */
export function setPolicyCommand(projectId, region, setting) {
    return `firebase ${setPolicyArgs(projectId, region, setting).join(' ')}`;
}

/** What the policy keeps, for messages. */
function describe(setting) {
    return setting === 'none' ? 'no cleanup (artifactCleanupDays is none)' : `images kept ${setting} day${setting === 1 ? '' : 's'}`;
}

/** Runs `firebase` quietly, collecting its output. */
function firebase(args) {
    return new Promise((done) => {
        const child = spawn('firebase', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.on('close', (code) => done({ status: code ?? 1, output }));
        child.on('error', (err) => done({ status: 1, output: String(err) }));
    });
}

/** The first error line of a failed run, for the warning. */
function reason(output) {
    const line = output.replace(/\x1b\[[0-9;]*m/g, '').split('\n').find((l) => /error/i.test(l));
    return line ? ` (${line.trim()})` : '';
}

/**
 * One attempt: sets the policy, and remembers it when that worked. Returns 'set',
 * 'missing' or 'failed'. `deps.exec` replaces the Firebase CLI in tests.
 */
export async function applyPolicy(projectId, { region, setting, deps = {} }) {
    const { exec = firebase, readState = () => ({}), save = () => {} } = deps;
    const run = await exec(setPolicyArgs(projectId, region, setting));
    const result = policyResult(run.status, run.output);
    if (result === 'set') {
        try { save(rememberPolicy(readState(), projectId, region, setting)); } catch { /* a remembered policy is a convenience */ }
    }
    return { result, output: run.output };
}

/** What the deploy says about the policy once it is done trying. */
export function reportPolicy(result, projectId, { region, setting, deps = {} }, output = '') {
    const { log = console.log } = deps;
    if (result === 'set') log(`> Cleanup policy for the functions' container images in ${region}: ${describe(setting)}.`);
    else if (result === 'missing') {
        log(`\nThe functions' container image repository in ${region} still does not exist, so its cleanup policy is not set yet. The next deploy sets it.`);
    } else {
        log(`\nCould not set the cleanup policy for the functions' container images in ${region}${reason(output)}. `
            + `The next deploy tries again. To set it now: ${setPolicyCommand(projectId, region, setting)}`);
    }
}

/**
 * Before a deploy with functions: makes sure the repository has the policy. Never
 * stops a deploy. Returns 'remembered', 'set', 'missing' (a first deploy) or
 * 'failed'; for the last two, start watchForRepository.
 */
export async function ensureCleanupPolicy(projectId, { region, setting, deps = {} }) {
    const { readState = () => ({}), log = console.log } = deps;
    if (rememberedPolicy(readState(), projectId, region, setting)) return 'remembered';
    const { result, output } = await applyPolicy(projectId, { region, setting, deps });
    if (result === 'set') reportPolicy(result, projectId, { region, setting, deps });
    else if (result === 'missing') {
        log(`> The functions' container image repository in ${region} does not exist yet (a first deploy). `
            + `Its cleanup policy (${describe(setting)}) is set as soon as this deploy creates it.`);
    } else {
        log(`> Could not set the cleanup policy for the functions' container images in ${region} yet${reason(output)}. `
            + 'Trying again while the deploy runs.');
    }
    return result;
}

/**
 * On a first deploy: tries again every `every` ms while the deploy runs, until the
 * repository exists and has the policy. `stop()` ends that after the deploy, with a
 * last try (the repository exists once any function was built), and returns the result.
 */
export function watchForRepository(projectId, { region, setting, deps = {}, every = REPOSITORY_POLL_MS }) {
    let result = 'missing';
    let output = '';
    let busy = null;
    const attempt = () => {
        if (result === 'set' || busy) return busy;
        busy = applyPolicy(projectId, { region, setting, deps })
            .then((done) => { if (result !== 'set') ({ result, output } = done); return done; })
            .finally(() => { busy = null; });
        return busy;
    };
    // setInterval, not setTimeout: the CI test runs every long setTimeout at once.
    const timer = setInterval(attempt, every);
    timer.unref?.();
    return {
        async stop() {
            clearInterval(timer);
            if (busy) await busy;
            if (result !== 'set') await attempt();
            reportPolicy(result, projectId, { region, setting, deps }, output);
            return result;
        },
    };
}
