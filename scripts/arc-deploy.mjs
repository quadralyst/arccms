#!/usr/bin/env node
/**
 * `firebase deploy` for this install (specs/coexistence-spec.md, CO-D14, CO3.2).
 *
 * With no arguments it runs the guided deploy (arc-deploy-menu.mjs, docs/operations/deploy.html).
 * Otherwise it passes every argument through to `firebase deploy`, and:
 *
 * - picks the project the way the Firebase CLI does (--project, else the one
 *   chosen with `firebase use`, else the `default` alias), and always passes it
 *   to the CLI. It used to take the `default` alias whenever --project was
 *   missing while the CLI deployed to the `firebase use` project, so after
 *   `firebase use production` the production project was deployed with the dev
 *   project's config: its database id, its rules targets (review O4);
 * - adds `--config firebase.<projectId>.json` when `npm run arc:configure`
 *   generated one for the target project, so a project set up with a named
 *   database, its own bucket or its own hosting site deploys those. Without that
 *   file this is plain `firebase deploy` against firebase.json;
 * - builds the functions (`tsc`) before a deploy that includes them. The CLI
 *   uploads functions/lib as it is, so without this a deploy ships the last
 *   build and new functions are silently missing (found 2026-09-24);
 * - retries the functions the CLI started creating or updating but never
 *   reported success for. A deploy of many functions hits Google's per-minute
 *   limit on changes (HTTP 429), and the CLI gives up on a few after its own
 *   retries (found 2026-09-28). The wrapper waits for the limit to reset and
 *   deploys just those, up to RETRY_ROUNDS times;
 * - fails a functions deploy in which a function still never reported success
 *   after that. The CLI can exit 0 after a rate limit quietly skipped an
 *   update, leaving the old code live (found 2026-09-24);
 * - before a deploy of the whole functions codebase, lists the deployed functions
 *   the build no longer has (a feature turned off in src/custom/features.ts, a
 *   search collection removed) and asks once before letting Firebase delete them;
 *   off a terminal it needs --yes, and stops rather than delete unasked. A
 *   targeted deploy (functions:arccms:arccms.<name>) never deletes anything
 *   (specs/feature-flags-spec.md, section 7);
 * - before a deploy that includes functions, checks that they run next to the
 *   database (scripts/arc-region.mjs): with none deployed yet they go where the
 *   database is; deployed elsewhere, it warns and deploys anyway;
 * - before a deploy that includes functions with the sms feature, checks once per
 *   project that phone sign-in can sign people in (scripts/arc-sign-in-setup.mjs),
 *   and on a terminal offers to set it up; never stops the deploy;
 * - with --probe, after a deploy that included functions, runs the callable
 *   access check. A callable whose creation timed out is left without public
 *   access, and every browser call to it then fails with 403 (found 2026-09-23).
 *   Off by default since 2026-09-28: it calls every callable one by one, which
 *   made even a one-function deploy slow. Only a newly created callable can
 *   lose its access; run it after a deploy that adds one, and before a release;
 * - deploys the website without a gap (scripts/arc-hosting-release.mjs): the
 *   build goes to a preview channel first, then one live release holds the build
 *   and the pages the functions published, so the home page and content pages
 *   never drop to the browser app between the deploy and the republish. Every
 *   other target goes through `firebase deploy` as before (`--except hosting`).
 *
 *   node scripts/arc-deploy.mjs --only functions --project default
 */
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    DEFAULT_DATABASE_ID, ROOT, configForProject, readArcInstallConfig, readFirebaseAliases, resolveProjectId,
} from './arc-install-config.mjs';
import { deployedParts, gitHead, readState, recordDeploy, writeState } from './arc-deploy-state.mjs';
import { builtArccms } from './arc-built-functions.mjs';
import { main as configure, normalizeConfig } from './arc-configure.mjs';
import { checkSignInSetup, smsBuilt } from './arc-sign-in-setup.mjs';
import { channelDeployArgs, hostingSiteOf, releaseWebsite, withoutHosting } from './arc-hosting-release.mjs';
import {
    DEFAULT_FUNCTIONS_REGION, countArccms, databaseLocation, lookupDatabaseLocation, regionDecision, regionWarning,
} from './arc-region.mjs';

/** Retry rounds for functions that never reported success, and the wait before each. */
export const RETRY_ROUNDS = 2;
export const RETRY_WAIT_MS = 65_000;

/** The generated Firebase CLI config for a project. */
export function generatedConfigPath(projectId) {
    return resolve(ROOT, `firebase.${projectId}.json`);
}

/** The `--project` / `-P` value in firebase arguments, or '' when absent. */
export function projectArg(args) {
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--project=')) return arg.slice('--project='.length);
        if ((arg === '--project' || arg === '-P') && args[i + 1]) return args[i + 1];
    }
    return '';
}

/** Whether a deploy names this target (hosting, storage) in --only; a plain deploy names none. */
export function namesTarget(args, target) {
    const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
    if (i === -1) return false;
    const only = args[i].startsWith('--only=') ? args[i].slice('--only='.length) : args[i + 1] || '';
    return only.split(',').some((t) => t.trim().split(':')[0] === target);
}

/** Whether a deploy names hosting in --only (a plain deploy has no hosting target to check). */
export function namesHosting(args) {
    return namesTarget(args, 'hosting');
}

/** Whether a deploy with these arguments deploys functions. */
export function deploysFunctions(args) {
    const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
    if (i === -1) return true;
    const only = args[i].startsWith('--only=') ? args[i].slice('--only='.length) : args[i + 1] || '';
    return only.split(',').some((target) => target.trim().startsWith('functions'));
}

/**
 * Whether a deploy covers a whole functions codebase: no --only, or
 * `functions` / `functions:<codebase>`. Only then does the Firebase CLI delete
 * the deployed functions the build no longer has.
 */
export function deploysWholeFunctions(args) {
    const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
    if (i === -1) return true;
    const only = args[i].startsWith('--only=') ? args[i].slice('--only='.length) : args[i + 1] || '';
    return only.split(',').map((t) => t.trim()).some((t) => t === 'functions' || /^functions:[\w-]+$/.test(t));
}

/** The deployed ids (`arccms-<name>`) of the functions in a build, nested groups joined with `-`. */
export function functionIds(group, prefix = 'arccms-') {
    return Object.entries(group ?? {}).flatMap(([key, value]) => {
        if (value && value.__endpoint) return [prefix + key];
        if (value && typeof value === 'object' && !Array.isArray(value)) return functionIds(value, `${prefix}${key}-`);
        return [];
    });
}

/** Deployed functions of the arccms codebase that the build does not have. */
export function removedDeployed(deployed, builtIds) {
    const built = new Set(builtIds);
    return deployed
        .filter((fn) => (fn.codebase || fn.labels?.['firebase-functions-codebase']) === 'arccms' && !built.has(fn.id))
        .sort((a, b) => a.id.localeCompare(b.id));
}

/** The same, by id. */
export function removedFunctions(deployed, builtIds) {
    return removedDeployed(deployed, builtIds).map((fn) => fn.id);
}

/**
 * Whether every error a deploy reported was a functions error. The CLI prints
 * `Error: There was an error deploying functions:` for those; a rules or hosting
 * failure prints its own `Error:` line, which a functions retry cannot fix.
 */
export function onlyFunctionErrors(output) {
    const errors = output.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((line) => /^Error:/.test(line));
    return errors.length > 0 && errors.every((line) => /deploying functions/.test(line));
}

/** Confirmed deletions, by region, as `firebase functions:delete` takes them. */
export function deletesByRegion(fns) {
    const byRegion = {};
    for (const fn of fns) (byRegion[fn.region] ??= []).push(fn.id);
    return byRegion;
}

/**
 * Whether the listed deletions may go ahead: --yes or an explicit --force says
 * so, a terminal asks once, and anything else stops the deploy.
 */
export async function confirmDeletes(removed, args, { isTTY = !!process.stdin.isTTY, ask } = {}) {
    if (!removed.length) return { proceed: true, force: false };
    console.log(`\nThis deploy deletes ${removed.length} function(s) the build no longer has: a feature turned off in `
        + `src/custom/features.ts, a search collection removed, or code renamed.\n  ${removed.join('\n  ')}`);
    if (args.includes('--yes') || args.includes('--force')) return { proceed: true, force: true };
    if (!isTTY) {
        console.error('\nNot deleting without a yes. Run again with --yes to delete them, or deploy only the functions '
            + 'you changed (--only functions:arccms:arccms.<name>), which deletes nothing. Nothing was deployed.');
        return { proceed: false, force: false };
    }
    const answer = await (ask ?? askOnce)('Delete them? [y/N] ');
    if (/^y(es)?$/i.test(answer.trim())) return { proceed: true, force: true };
    console.log('Nothing was deployed.');
    return { proceed: false, force: false };
}

async function askOnce(question) {
    // Line mode: terminal mode redraws the question as you type, so it showed twice.
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    try {
        return await rl.question(question);
    } finally {
        rl.close();
    }
}

/** A project's install settings from arccms.config.json, defaults filled in. */
export function projectConfig(projectId) {
    return normalizeConfig(configForProject(readArcInstallConfig(), projectId));
}

/** The region a project's functions run in. */
export function functionsRegionOf(projectId) {
    return projectConfig(projectId).functionsRegion || DEFAULT_FUNCTIONS_REGION;
}

/**
 * Before a functions deploy: are the functions next to the database
 * (scripts/arc-region.mjs)? With no Arc CMS function deployed yet they are
 * simply set to run where the database is, and the deploy goes on, except when
 * it also publishes a website built for the old region: that must be built
 * again first. Deployed elsewhere: a warning, unless turned off for the
 * project, and the deploy goes on. Returns `{ proceed, decision }`.
 *
 * `deps` replaces the lookups, the listing and the config writer in tests.
 */
export function checkFunctionsRegion(projectId, { includesWebsite = false, deps = {} } = {}) {
    const {
        config = projectConfig(projectId), state = readState(), save = writeState,
        lookup = lookupDatabaseLocation, list = listDeployed, write = configure, log = console.log,
    } = deps;
    const found = databaseLocation(state, projectId, config.databaseId || DEFAULT_DATABASE_ID, lookup);
    if (found.state !== state) {
        try { save(found.state); } catch { /* a remembered location is a convenience */ }
    }
    const region = config.functionsRegion || DEFAULT_FUNCTIONS_REGION;
    let decision = regionDecision({ location: found.location, region, deployedArccms: 0 });
    if (decision.kind === 'ok') return { proceed: true, decision };
    decision = regionDecision({ location: found.location, region, deployedArccms: countArccms(list(projectId)) });

    if (decision.kind === 'adopt') {
        const messages = [];
        if (write([`--project=${projectId}`, `--functions-region=${decision.suggested}`], undefined, (line) => messages.push(line)) !== 0) {
            log(messages.join('\n'));
            return { proceed: false, decision };
        }
        log(`\nThe functions will run in ${decision.suggested}, next to your database (${decision.location}).`
            + ' Saved in arccms.config.json: commit it with src/environments/arc-install.ts.');
        if (includesWebsite) {
            log('The website calls the functions there only once it is built again. Build it, then deploy again. Nothing was deployed.');
            return { proceed: false, decision };
        }
        return { proceed: true, decision };
    }
    if (!found.state.regionWarningOff?.[projectId]) log(`\n${regionWarning(decision, projectId)}\n`);
    return { proceed: true, decision };
}

/** Whether a deploy with these arguments publishes the website: hosting named, or no --only at all. */
export function deploysWebsite(args) {
    return namesHosting(args) || !args.some((a) => a === '--only' || a.startsWith('--only='));
}

/** The functions deployed in a project, or null when the CLI cannot list them. */
function listDeployed(projectId) {
    const result = spawnSync('firebase', ['functions:list', '--json', '--project', projectId], {
        encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024,
    });
    try {
        const parsed = JSON.parse(String(result.stdout || ''));
        return parsed.status === 'success' && Array.isArray(parsed.result) ? parsed.result : null;
    } catch {
        return null;
    }
}

/**
 * Whether a deploy deploys functions and nothing else. Only then can a clean
 * retry clear the first run's failure: in a mixed deploy the failure may have
 * come from rules or hosting, which the retry does not touch.
 */
export function deploysOnlyFunctions(args) {
    const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
    if (i === -1) return false;
    const only = args[i].startsWith('--only=') ? args[i].slice('--only='.length) : args[i + 1] || '';
    const targets = only.split(',').map((t) => t.trim()).filter(Boolean);
    return targets.length > 0 && targets.every((t) => t.startsWith('functions'));
}

/**
 * The `firebase` arguments for a deploy. An explicit --config/-c wins; otherwise
 * the target project's generated config is added when it exists. The project is
 * always named, so the CLI deploys to the project whose config this is.
 */
export function deployArgs(args, generatedExists, projectId, cwd = process.cwd()) {
    const passthrough = args.filter((a) => a !== '--no-probe' && a !== '--probe' && a !== '--yes');
    const withProject = projectArg(passthrough) || !projectId ? passthrough : [...passthrough, '--project', projectId];
    const hasConfig = passthrough.some((a) => a === '--config' || a === '-c' || a.startsWith('--config='));
    if (hasConfig || !generatedExists || !projectId) return ['deploy', ...withProject];
    const config = generatedConfigPath(projectId);
    return ['deploy', '--config', relative(cwd, config) || config, ...withProject];
}

/**
 * The project the Firebase CLI deploys to when no --project is given: the one
 * chosen with `firebase use` for this directory (it falls back to the
 * `default` alias itself), or '' when the CLI cannot say.
 */
export function cliActiveProject(run = spawnSync) {
    const result = run('firebase', ['use', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
    try {
        const parsed = JSON.parse(String(result.stdout || ''));
        return parsed.status === 'success' && typeof parsed.result === 'string' ? parsed.result : '';
    } catch {
        return '';
    }
}

/** The project a deploy targets: --project, else the CLI's active project, else the `default` alias. */
export function deployProject(args, aliases, active = () => cliActiveProject()) {
    const explicit = projectArg(args);
    if (explicit) return resolveProjectId(explicit, aliases);
    return active() || resolveProjectId('', aliases);
}

/**
 * Functions the CLI started working on but never reported success for, from its
 * output. Lines look like
 *   `i  functions: updating Node.js 22 (2nd Gen) function arccms:arccms-search(us-central1)...`
 *   `✔  functions[arccms:arccms-search(us-central1)] Successful update operation.`
 */
export function unconfirmedFunctions(output) {
    return unconfirmed(output).map((fn) => `${fn.name}(${fn.region})`);
}

/**
 * The same, with each function's codebase and whether it was a delete. Colour
 * codes are stripped first, so the patterns hold when the CLI writes colour.
 */
export function unconfirmed(output) {
    const started = new Map();
    const confirmed = new Set();
    for (const line of output.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
        const start = /\b(creating|updating|deleting) .*? function (?:([\w-]+):)?([\w-]+)\(([\w-]+)\)\.\.\./.exec(line);
        if (start) {
            started.set(`${start[3]}(${start[4]})`, {
                codebase: start[2] || '', name: start[3], region: start[4], deleting: start[1] === 'deleting',
            });
        }
        const done = /functions\[(?:[\w-]+:)?([\w-]+)\(([\w-]+)\)\] Successful (?:create|update|delete) operation/.exec(line);
        if (done) confirmed.add(`${done[1]}(${done[2]})`);
    }
    return [...started.entries()]
        .filter(([key]) => !confirmed.has(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, fn]) => fn);
}

/**
 * The `--only` targets that redeploy these functions. A grouped function's id
 * joins its groups with `-` (`arccms-search`); the CLI selects it as
 * `functions:<codebase>:arccms.search`. Deletes are left out: a redeploy
 * cannot finish a delete, so those are reported instead.
 */
export function retryTargets(functions) {
    return functions
        .filter((fn) => !fn.deleting)
        .map((fn) => `functions:${fn.codebase ? `${fn.codebase}:` : ''}${fn.name.split('-').join('.')}`);
}

/** The deploy arguments with `--only` replaced by these targets. */
export function retryArgs(firebaseArgs, targets) {
    const out = [];
    for (let i = 0; i < firebaseArgs.length; i++) {
        const arg = firebaseArgs[i];
        if (arg === '--only') { i++; continue; }
        if (arg.startsWith('--only=')) continue;
        out.push(arg);
    }
    return [...out, '--only', targets.join(',')];
}

/** Runs a command with its output streamed live and also collected. */
function run(cmd, args) {
    return new Promise((resolvePromise) => {
        const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
        let output = '';
        child.stdout.on('data', (chunk) => { process.stdout.write(chunk); output += chunk; });
        child.stderr.on('data', (chunk) => { process.stderr.write(chunk); output += chunk; });
        child.on('close', (code) => resolvePromise({ status: code ?? 1, output }));
        child.on('error', (err) => resolvePromise({ status: 1, output: String(err) }));
    });
}

/**
 * Functions the CLI created in this deploy (not updated), by the plain name the
 * callable check takes: `arccms-foo` is `foo`, `arccms-custom-foo` is
 * `custom-foo`. Functions outside the arccms group are left out.
 */
export function createdFunctions(output) {
    const names = new Set();
    for (const line of output.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
        const done = /functions\[(?:[\w-]+:)?arccms-([\w-]+)\([\w-]+\)\] Successful create operation/.exec(line);
        if (done) names.add(done[1]);
    }
    return [...names].sort();
}

/**
 * Deploys with these `firebase deploy` arguments: the flag path, and what the
 * guided deploy (arc-deploy-menu.mjs) runs. Returns the exit status and the
 * functions this deploy created. `options.built`: the functions are built
 * already, so skip the build. A successful deploy is recorded for the guided
 * deploy's "only what changed" (arc-deploy-state.mjs) unless `options.record`
 * is false (the menu records its own, with the function names).
 */
export async function runDeploy(args, options = {}) {
    const projectId = deployProject(args, readFirebaseAliases());
    if (!projectId) {
        console.error('No Firebase project: pass --project=<alias or id>, run firebase use, or add a "default" alias to .firebaserc.');
        return { status: 1, created: [] };
    }
    // Before the config is read: a first deploy may set the functions region.
    if (deploysFunctions(args) && !options.regionChecked) {
        if (!checkFunctionsRegion(projectId, { includesWebsite: deploysWebsite(args) }).proceed) return { status: 1, created: [] };
    }
    const generated = !!projectId && existsSync(generatedConfigPath(projectId));
    // Hosting off (arc:configure --site=none) leaves no hosting in the generated
    // config, so say that plainly rather than pass on the CLI's error (review O2).
    const generatedConfig = generated ? JSON.parse(readFileSync(generatedConfigPath(projectId), 'utf8')) : null;
    if (generatedConfig && namesHosting(args) && !generatedConfig.hosting) {
        console.error(`Hosting is off for ${projectId} (arc:configure --site=none): there is no website to deploy here.`);
        return { status: 1, created: [] };
    }
    // Arc CMS in another app's bucket: its storage rules would replace the
    // other app's, so the generated config has none (review F).
    if (generatedConfig && namesTarget(args, 'storage') && !generatedConfig.storage) {
        console.error(`Storage rules are not deployed for ${projectId}: Arc CMS keeps its files in the default bucket, which another app uses, `
            + 'and a bucket has one rules file, so this would replace that app\'s rules. Give Arc CMS its own bucket first (docs/operations/deploy.html).');
        return { status: 1, created: [] };
    }
    // The website goes its own way, keeping the published pages; the rest through `firebase deploy`.
    const firebaseConfig = generatedConfig ?? readJsonFile(resolve(ROOT, 'firebase.json'));
    const website = deploysWebsite(args) && !!firebaseConfig?.hosting;
    const mainArgs = website ? withoutHosting(args) : args;
    const firebaseArgs = mainArgs ? deployArgs(mainArgs, generated, projectId) : null;
    if (deploysFunctions(args) && !options.built) {
        console.log('> npm run build --prefix functions');
        const build = spawnSync('npm', ['run', 'build', '--prefix', resolve(ROOT, 'functions')], {
            stdio: 'inherit', shell: process.platform === 'win32',
        });
        if (build.status !== 0) {
            console.error('\nThe functions build failed, so nothing was deployed.');
            return { status: build.status ?? 1, created: [] };
        }
    }
    if (deploysFunctions(args) && !options.signInSetupChecked && smsBuilt()) {
        await checkSignInSetup(projectId, {
            state: readState(), save: writeState, ask: options.askSignInSetup ?? askOnce, isTTY: options.isTTY ?? !!process.stdin.isTTY,
        });
    }
    // Functions the user agreed to delete, so they can be finished off if the CLI skips them.
    let toDelete = [];
    if (deploysFunctions(args) && deploysWholeFunctions(args)) {
        const deployed = listDeployed(projectId);
        if (!deployed) {
            console.warn('Could not list the deployed functions; the Firebase CLI will ask before deleting any.');
        } else {
            const removed = removedDeployed(deployed, functionIds(await builtArccms()));
            const { proceed, force } = await confirmDeletes(removed.map((fn) => fn.id), args, options);
            if (!proceed) return { status: 1, created: [] };
            if (force && !firebaseArgs.includes('--force')) firebaseArgs.push('--force');
            toDelete = removed;
        }
    }
    let deploy = { status: 0, output: '' };
    if (firebaseArgs) {
        console.log(`> firebase ${firebaseArgs.join(' ')}`);
        deploy = await run('firebase', firebaseArgs);
    }
    let status = deploy.status;
    const created = new Set(createdFunctions(deploy.output));

    let missing = unconfirmed(deploy.output);
    for (let round = 1; round <= RETRY_ROUNDS && retryTargets(missing).length; round++) {
        const targets = retryTargets(missing);
        const deletes = missing.filter((fn) => fn.deleting);
        console.log(`\n${targets.length} function(s) never reported success, likely Google's per-minute limit on changes. `
            + `Waiting ${Math.round(RETRY_WAIT_MS / 1000)} seconds, then deploying just those (retry ${round} of ${RETRY_ROUNDS}).`);
        await new Promise((done) => setTimeout(done, RETRY_WAIT_MS));
        const again = retryArgs(firebaseArgs, targets);
        console.log(`> firebase ${again.join(' ')}`);
        const retry = await run('firebase', again);
        for (const name of createdFunctions(retry.output)) created.add(name);
        missing = [...deletes, ...unconfirmed(retry.output)];
        // A clean retry clears the first run's failure when that failure was only functions.
        if (retry.status === 0 && !missing.length && (status === 0 || deploysOnlyFunctions(args) || onlyFunctionErrors(deploy.output))) status = 0;
    }
    // When any function fails to create or update, the CLI skips every delete, and a
    // targeted retry never deletes. Finish the deletes the user agreed to.
    if (toDelete.length) {
        const stillThere = (listDeployed(projectId) ?? []).filter((fn) => toDelete.some((d) => d.id === fn.id));
        if (stillThere.length) {
            console.log(`\nThe Firebase CLI skipped deleting ${stillThere.length} function(s); deleting them now.`);
            for (const [region, ids] of Object.entries(deletesByRegion(stillThere))) {
                const del = ['functions:delete', ...ids, '--region', region, '--project', projectId, '--force'];
                console.log(`> firebase ${del.join(' ')}`);
                const result = await run('firebase', del);
                if (result.status !== 0) {
                    console.error(`\nCould not delete ${ids.join(', ')}. Delete them with: firebase ${del.join(' ')}`);
                    status = status || 1;
                }
            }
        }
    }
    if (missing.length) {
        const names = missing.map((fn) => `${fn.name}(${fn.region})${fn.deleting ? ', a delete' : ''}`);
        console.error(`\nThese functions were started but never reported success, so the old version may still be live:\n  ${names.join('\n  ')}\nRedeploy them: npm run deploy -- --only ${retryTargets(missing).join(',') || 'functions:<codebase>:<group>.<name>'}`);
        status = status || 1;
    }

    if (website && status === 0) status = await deployWebsite(projectId, generated ? generatedConfigPath(projectId) : null, firebaseConfig);

    if (status === 0 && projectId && deploysFunctions(args) && args.includes('--probe')) {
        console.log(`\n> Checking that every callable is publicly invocable on ${projectId}`);
        const probe = spawnSync('bash', [resolve(ROOT, 'functions/scripts/check-callable-access.sh')], {
            stdio: 'inherit',
            env: { ...process.env, FIREBASE_PROJECT: projectId, FIREBASE_REGION: functionsRegionOf(projectId) },
        });
        if (probe.status !== 0) {
            console.error('\nSome callables are blocked. Delete and redeploy them (a fresh create grants access).');
            status = probe.status ?? 1;
        }
    }
    if (status === 0 && options.record !== false) {
        const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
        const only = i === -1 ? null : args[i].startsWith('--only=') ? args[i].slice('--only='.length) : args[i + 1] || '';
        const parts = deployedParts(only);
        if (parts.length) {
            try {
                writeState(recordDeploy(readState(), projectId, parts, { commit: gitHead(), at: new Date().toISOString() }));
            } catch { /* a record is a convenience; never fail a deploy over it */ }
        }
    }
    return { status, created: [...created].sort() };
}

function readJsonFile(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * The website, keeping the published pages: the build to the deploy channel,
 * then one live release of the build and the published files. Returns the exit status.
 */
async function deployWebsite(projectId, configPath, firebaseConfig) {
    const channelArgs = channelDeployArgs({ projectId, configPath: configPath ? relative(process.cwd(), configPath) || configPath : null });
    console.log(`> firebase ${channelArgs.join(' ')}`);
    const channel = await run('firebase', channelArgs);
    if (channel.status !== 0) {
        console.error('\nThe website build could not be uploaded; the live site is unchanged.');
        return channel.status || 1;
    }
    const site = hostingSiteOf(firebaseConfig, projectId);
    try {
        console.log(`> releasing the build to ${site}, keeping the published pages`);
        await releaseWebsite({ site });
        return 0;
    } catch (error) {
        console.error(`\nThe website was not released: ${error.message}\nThe live site is unchanged. Run the same deploy again.`);
        return 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        // No options: the guided deploy, or the list of options off a terminal. Its
        // own process: the menu imports this module, which is still loading here.
        const menu = spawnSync(process.execPath, [resolve(ROOT, 'scripts/arc-deploy-menu.mjs')], { stdio: 'inherit' });
        process.exitCode = menu.status ?? 1;
    } else {
        process.exitCode = (await runDeploy(args)).status;
    }
}
