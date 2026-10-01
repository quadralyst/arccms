/**
 * Before a functions deploy with the sms feature: is the project set up for phone sign-in?
 * (docs/features/sign-in.html, "Google Cloud setup".)
 *
 * The last step of every phone sign-in signs a token as the functions' service account,
 * which needs two things a new Firebase project does not have:
 *
 * - the IAM Service Account Credentials API turned on;
 * - the Service Account Token Creator role for the account (granted on the account itself).
 *
 * With gcloud installed this checks both, once per project, and on a terminal offers to
 * set up what is missing. It never stops a deploy: the admin page checks again
 * (Settings, User Settings) before phone sign-in can be turned on. The answer is
 * remembered in .arc-deploy-state.json (`signInSetup`): `ok` and `declined` are final,
 * `no-gcloud` checks again once gcloud is installed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './arc-install-config.mjs';

export const TOKEN_CREATOR_ROLE = 'roles/iam.serviceAccountTokenCreator';
export const IAM_CREDENTIALS_API = 'iamcredentials.googleapis.com';

/** Whether the functions build has the sms feature (phone sign-in), from the generated list. */
export function smsBuilt(root = ROOT) {
    try {
        const text = readFileSync(resolve(root, 'functions/src/enabled-features.gen.ts'), 'utf8');
        const list = JSON.parse(/=\s*(\[[^\]]*\])/.exec(text)?.[1] ?? '[]');
        return Array.isArray(list) && list.includes('sms');
    } catch {
        return false;
    }
}

/** The default compute account, which 2nd gen functions with no account of their own run as. */
export function computeServiceAccount(projectNumber) {
    return `${projectNumber}-compute@developer.gserviceaccount.com`;
}

/** Whether an IAM policy (gcloud's JSON) gives `member` the Token Creator role. */
export function grantsTokenCreator(policy, member) {
    return (policy?.bindings ?? []).some((b) => b.role === TOKEN_CREATOR_ROLE && (b.members ?? []).includes(member));
}

/** The gcloud commands that set up what is missing. */
export function setupCommands({ projectId, serviceAccount, apiOn, roleOn }) {
    const commands = [];
    if (!apiOn) commands.push(['services', 'enable', IAM_CREDENTIALS_API, `--project=${projectId}`]);
    if (!roleOn) {
        commands.push(['iam', 'service-accounts', 'add-iam-policy-binding', serviceAccount,
            `--member=serviceAccount:${serviceAccount}`, `--role=${TOKEN_CREATOR_ROLE}`, `--project=${projectId}`]);
    }
    return commands;
}

function gcloudRunner(run) {
    return (args) => {
        const result = run('gcloud', args, { encoding: 'utf8', shell: process.platform === 'win32' });
        return { ok: !result.error && result.status === 0, out: String(result.stdout ?? '').trim(), missing: result.error?.code === 'ENOENT' };
    };
}

/**
 * What the project has: `{ serviceAccount, apiOn, roleOn }`, `{ noGcloud: true }`, or null
 * when gcloud could not tell (not signed in, no access): then nothing is said or changed.
 */
export function inspectSetup(projectId, run = spawnSync) {
    const gcloud = gcloudRunner(run);
    const version = gcloud(['--version']);
    if (version.missing || !version.ok) return { noGcloud: true };
    const number = gcloud(['projects', 'describe', projectId, '--format=value(projectNumber)']);
    if (!number.ok || !/^\d+$/.test(number.out)) return null;
    const serviceAccount = computeServiceAccount(number.out);
    const member = `serviceAccount:${serviceAccount}`;

    const api = gcloud(['services', 'list', '--enabled', `--project=${projectId}`,
        `--filter=config.name=${IAM_CREDENTIALS_API}`, '--format=value(config.name)']);
    if (!api.ok) return null;
    const apiOn = api.out.includes(IAM_CREDENTIALS_API);

    let roleOn = false;
    for (const args of [
        ['iam', 'service-accounts', 'get-iam-policy', serviceAccount, `--project=${projectId}`, '--format=json'],
        ['projects', 'get-iam-policy', projectId, '--format=json'],
    ]) {
        const policy = gcloud(args);
        if (!policy.ok) continue;
        try {
            if (grantsTokenCreator(JSON.parse(policy.out || '{}'), member)) roleOn = true;
        } catch { /* unreadable: treat as not granted */ }
        if (roleOn) break;
    }
    return { serviceAccount, apiOn, roleOn };
}

/**
 * The check itself. `deps` replaces gcloud, the state file, the question and the log in tests.
 * Returns what it found: 'ok', 'set-up', 'declined', 'missing', 'no-gcloud', 'unknown' or 'skipped'.
 */
export async function checkSignInSetup(projectId, deps = {}) {
    const {
        run = spawnSync, state = {}, save = () => {}, ask, isTTY = !!process.stdin.isTTY, log = console.log,
    } = deps;
    const known = state.signInSetup?.[projectId];
    if (known === 'ok' || known === 'declined') return 'skipped';
    const remember = (value) => {
        try {
            save({ ...state, signInSetup: { ...state.signInSetup, [projectId]: value } });
        } catch { /* a remembered answer is a convenience */ }
    };

    const found = inspectSetup(projectId, run);
    if (found?.noGcloud) {
        if (known !== 'no-gcloud') {
            log('\nPhone sign-in needs one Google Cloud setting on each project. Install gcloud and deploy again to have it checked, '
                + 'or check it on Settings, User Settings when you turn phone sign-in on. See docs/features/sign-in.html.\n');
            remember('no-gcloud');
        }
        return 'no-gcloud';
    }
    if (!found) return 'unknown';
    if (found.apiOn && found.roleOn) {
        remember('ok');
        return 'ok';
    }

    const commands = setupCommands({ projectId, ...found });
    const missing = [
        ...(found.apiOn ? [] : [`the ${IAM_CREDENTIALS_API} API is off`]),
        ...(found.roleOn ? [] : [`${found.serviceAccount} does not have the Service Account Token Creator role`]),
    ];
    log(`\nPhone sign-in cannot sign anyone in on ${projectId} yet: ${missing.join(', and ')}.`);
    if (!isTTY || !ask) {
        log(`Set it up with:\n  ${commands.map((c) => `gcloud ${c.join(' ')}`).join('\n  ')}\nSee docs/features/sign-in.html.\n`);
        return 'missing';
    }
    const answer = await ask('Set it up now? [Y/n] ');
    if (/^n(o)?$/i.test(answer.trim())) {
        log(`Not changed. Phone sign-in stays off until it is set up (docs/features/sign-in.html):\n  ${commands.map((c) => `gcloud ${c.join(' ')}`).join('\n  ')}\n`);
        remember('declined');
        return 'declined';
    }
    const gcloud = gcloudRunner(run);
    for (const args of commands) {
        log(`> gcloud ${args.join(' ')}`);
        if (!gcloud(args).ok) {
            log('That did not work (it needs the Owner or Security Admin role on the project). The deploy goes on; '
                + 'run the command yourself, or follow docs/features/sign-in.html.\n');
            return 'missing';
        }
    }
    log('Phone sign-in is set up on this project.\n');
    remember('ok');
    return 'set-up';
}
