/**
 * The guided deploy: `npm run deploy` with no options (docs/operations/deploy.html).
 *
 * It asks, one step at a time with a default each, and then deploys:
 *   1. the project (the `.firebaserc` aliases; the `firebase use` one first);
 *   2. its install settings, rebuilt from arccms.config.json every time so the
 *      generated files are never stale, and a stop when this checkout has none
 *      for a project the committed arc-install.ts says is set up (review O5).
 *      A project nothing knows about is offered the first-time setup;
 *   3. what to deploy, including "only the functions changed since the last
 *      deploy", worked out from git and the functions' imports;
 *   4. a summary and the exact command, and for production, the project id
 *      typed back as the confirmation.
 * It remembers the choices per checkout in .arc-deploy-state.json (not
 * committed). `npm run deploy -- <firebase options>` skips all of this.
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    DEFAULT_DATABASE_ID, ROOT, configForProject, readArcInstallConfig, readFirebaseAliases,
} from './arc-install-config.mjs';
import {
    checkFunctionsRegion, cliActiveProject, functionsRegionOf, generatedConfigPath, runDeploy,
} from './arc-deploy.mjs';
import { DEFAULT_FUNCTIONS_REGION } from './arc-region.mjs';
import { deployedParts, gitHead, readState, recordDeploy, writeState } from './arc-deploy-state.mjs';
import {
    APP_USERS_OWN, APP_USERS_UNCONFIGURED, HOSTING_OFF, OWN_USERS_PATH, PATHS,
    main as configure, normalizeConfig, sharesDefaultBucket,
} from './arc-configure.mjs';

const FUNCTIONS_SRC = resolve(ROOT, 'functions/src');

// ---------------------------------------------------------------------------
// Step 1: the project
// ---------------------------------------------------------------------------

/**
 * The projects to offer: every `.firebaserc` alias, plus the `firebase use`
 * project if it has no alias. The default is the last one deployed from this
 * menu, else the `firebase use` one, else the `default` alias.
 */
export function projectOptions(aliases, active, last) {
    const options = Object.entries(aliases).map(([alias, projectId]) => ({ alias, projectId, label: `${alias} (${projectId})` }));
    if (active && !options.some((o) => o.projectId === active)) options.push({ alias: '', projectId: active, label: active });
    const pick = (id) => options.findIndex((o) => o.projectId === id);
    const byAlias = options.findIndex((o) => o.alias === 'default');
    const index = [pick(last), pick(active), byAlias, 0].find((i) => i >= 0) ?? 0;
    return { options, defaultIndex: index };
}

/** Production is confirmed by typing its id back: an alias or id that says prod or live. */
export function needsTypedConfirmation(alias, projectId) {
    return alias === 'production' || /(^|[-_])(prod|production|live)([-_]|$)/i.test(projectId);
}

// ---------------------------------------------------------------------------
// Step 2: the install settings (review O5)
// ---------------------------------------------------------------------------

/**
 * Whether arccms.config.json sets this project up: its own entry, or shared
 * keys that change something. A shared `databaseId: "(default)"` or `profile:
 * "standalone"` is only the default written down, so a project with nothing
 * else is still offered the first-time setup.
 */
export function hasInstallSettings(file, projectId) {
    const { projects, ...shared } = file ?? {};
    const meaningful = Object.entries(shared).filter(([key, value]) =>
        !(key === 'databaseId' && value === DEFAULT_DATABASE_ID) && !(key === 'profile' && value === 'standalone'));
    return meaningful.length > 0 || !!(projects && projects[projectId]);
}

/** The committed arc-install.ts entry for a project, or null. */
export function committedInstallEntry(tsText, projectId) {
    const start = tsText.indexOf(`${JSON.stringify(projectId)}: {`);
    if (start === -1) return null;
    const end = tsText.indexOf('},', start);
    const entry = {};
    for (const line of tsText.slice(start, end === -1 ? undefined : end).split('\n').slice(1)) {
        const match = /^\s*(\w+):\s*(.+?),?\s*$/.exec(line);
        if (!match) continue;
        try { entry[match[1]] = JSON.parse(match[2]); } catch { /* not a value line */ }
    }
    return entry;
}

/** One line per setting, in plain words. */
export function installSummary(config) {
    const hosting = config.hostingSite === HOSTING_OFF
        ? 'off'
        : config.hostingSite ? `its own site, ${config.hostingSite}` : "the project's main site";
    const appUsers = !config.appUsersPath || config.appUsersPath === APP_USERS_UNCONFIGURED
        ? 'none'
        : config.appUsers === APP_USERS_OWN ? "this site's own users" : `${config.appUsersPath} in ${config.appUsersDatabase || DEFAULT_DATABASE_ID}`;
    return [
        `Database:   ${config.databaseId || DEFAULT_DATABASE_ID}`,
        `Website:    ${hosting}`,
        `Storage:    ${config.storageBucket || 'the default bucket'}${config.storagePrefix ? `, folder ${config.storagePrefix}` : ''}`
            + `${sharesDefaultBucket(config) ? ' (shared with the other app, so no storage rules)' : ''}`,
        `App users:  ${appUsers}`,
        `Functions:  ${config.functionsRegion || DEFAULT_FUNCTIONS_REGION}`,
    ];
}

/**
 * Why deploying this project from this checkout is unsafe, or [] when it is not.
 * The committed arc-install.ts is what the website reads; the functions and rules
 * read the files this checkout generates. Deploying one without the other
 * would split the install across two databases.
 */
export function installProblems({ projectId, settings, committed }) {
    if (!settings && committed) {
        const database = committed.databaseId || DEFAULT_DATABASE_ID;
        return [
            `${projectId} is set up with the database "${database}" (src/environments/arc-install.ts, committed), `
            + 'but this checkout has no settings for it in arccms.config.json. Copy arccms.config.json from where the '
            + 'install was set up, then run the deploy again.',
        ];
    }
    if (settings && committed) {
        const want = settings.databaseId || DEFAULT_DATABASE_ID;
        const has = committed.databaseId || DEFAULT_DATABASE_ID;
        if (want !== has) {
            return [`arccms.config.json says the database is "${want}", but src/environments/arc-install.ts says "${has}".`];
        }
    }
    return [];
}

// ---------------------------------------------------------------------------
// Step 3: what to deploy
// ---------------------------------------------------------------------------

/** Files whose changes mean a target should be deployed again. */
const TARGET_PATHS = {
    rules: [/^firestore(\.app)?\.rules$/, /^firestore(\.app)?\.indexes\.json$/],
    storage: [/^storage(\.app)?\.rules$/],
    website: [/^src\//, /^public\//, /^index\.html$/, /^vite\.config\.ts$/, /^package(-lock)?\.json$/],
};

/** Builds the website and publishes its pages: only these projects have a build set up for them. */
export const WEBSITE_BUILDS = {
    default: { env: { USE_DEV_ENV: 'true' }, seed: 'dev' },
    production: { env: {}, seed: 'prod' },
};

/**
 * The deploy menu for a project. `changed` is from changedFunctions() (null
 * when there is no earlier deploy to compare with); `dirty` says which other
 * targets changed since their last deploy.
 */
export function deployChoices({ websiteOn, websiteBuild, changed, dirty = {}, storageOn = true }) {
    const mark = (key) => (dirty[key] ? '  (changed since the last deploy)' : '');
    const website = websiteOn && websiteBuild;
    const choices = [];
    if (changed && changed.targets.length) {
        choices.push({
            key: 'changed',
            label: `Only the functions changed since the last deploy (${changed.names.length})`,
            only: changed.targets,
        });
    }
    choices.push(
        {
            key: 'everything',
            label: `Everything: functions, database rules and indexes${storageOn ? ', storage rules' : ''}${website ? ', website' : ''}`,
            only: ['functions:arccms', 'firestore', ...(storageOn ? ['storage'] : []), ...(website ? ['hosting'] : [])],
            website,
        },
        { key: 'functions', label: 'All functions', only: ['functions:arccms'] },
        { key: 'rules', label: `Database rules and indexes${mark('rules')}`, only: ['firestore'] },
    );
    if (storageOn) choices.push({ key: 'storage', label: `Storage rules${mark('storage')}`, only: ['storage'] });
    if (website) choices.push({ key: 'website', label: `Website: build, publish, then the static pages${mark('website')}`, only: ['hosting'], website: true });
    return choices;
}

// ---------------------------------------------------------------------------
// Only the functions changed since the last deploy
// ---------------------------------------------------------------------------

function sourceFiles(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
        return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
    });
}

/**
 * What each source file imports and which functions it defines, from the
 * source text. Relative to functions/src, with `.ts` names.
 */
export function functionsGraph(files) {
    const imports = new Map();
    const defines = new Map();
    for (const [file, code] of files) {
        const deps = [];
        for (const match of code.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) {
            deps.push(join(dirname(file), match[1]).replace(/\.js$/, '.ts'));
        }
        imports.set(file, deps);
        const names = [...code.matchAll(/export const (\w+)\s*=\s*(?:on[A-Z]\w*|beforeUser\w*)\s*(?:<[^>]*>)?\s*\(/g)].map((m) => m[1]);
        if (names.length) defines.set(file, names);
    }
    return { imports, defines };
}

/** Every file a file depends on, itself included. */
function closure(graph, file, seen = new Set()) {
    if (seen.has(file)) return seen;
    seen.add(file);
    for (const dep of graph.imports.get(file) ?? []) closure(graph, dep, seen);
    return seen;
}

/** Changes outside the source that affect every function. */
const ALL_FUNCTIONS = [/^functions\/package(-lock)?\.json$/, /^functions\/tsconfig.*\.json$/, /^functions\/\.env/];

/**
 * The functions to deploy for these changed files (repo-relative paths).
 * `deployable` is every function name the build exports, the `custom` group
 * as `custom`; `previous` the names deployed last time, so new functions are
 * included. `all` is true when the change touches every function.
 */
export function affectedFunctions({ graph, changed, deployable, previous }) {
    if (changed.some((path) => ALL_FUNCTIONS.some((re) => re.test(path)))) return { all: true, names: [...deployable] };
    const changedSrc = new Set(changed.filter((p) => p.startsWith('functions/src/')).map((p) => p.slice('functions/src/'.length)));
    const names = new Set();
    for (const [file, defined] of graph.defines) {
        if (file.startsWith('custom/')) continue;
        const deps = closure(graph, file);
        if ([...deps].some((dep) => changedSrc.has(dep))) for (const name of defined) names.add(name);
    }
    if ([...changedSrc].some((p) => p.startsWith('custom/'))) names.add('custom');
    // A function the source defines in some other way: deploy it whenever the source changed.
    const found = new Set([...graph.defines.values()].flat());
    if (changedSrc.size) for (const name of deployable) if (name !== 'custom' && !found.has(name)) names.add(name);
    // New functions since the last deploy.
    if (previous) for (const name of deployable) if (!previous.includes(name)) names.add(name);
    const kept = [...names].filter((name) => deployable.includes(name)).sort();
    return { all: false, names: kept };
}

/** `--only` targets for function names (`custom` is the app's group). */
export function functionTargets(names) {
    return names.map((name) => `functions:arccms:arccms.${name}`);
}

function git(args) {
    const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    return result.status === 0 ? result.stdout : null;
}

/** Files changed since a commit, committed or not (the deploy builds the working tree). */
export function changedFilesSince(commit, run = git) {
    if (!commit || run(['cat-file', '-e', `${commit}^{commit}`]) === null) return null;
    const committed = run(['diff', '--name-only', commit, 'HEAD']) ?? '';
    const working = run(['status', '--porcelain', '--untracked-files=all']) ?? '';
    const files = new Set(committed.split('\n').filter(Boolean));
    for (const line of working.split('\n')) {
        const path = line.slice(3).split(' -> ').pop()?.trim();
        if (path) files.add(path);
    }
    return [...files];
}

/** The function names the built functions export (the build runs first). */
async function deployableFunctions() {
    const build = spawnSync('npm', ['run', 'build', '--prefix', resolve(ROOT, 'functions')], {
        encoding: 'utf8', shell: process.platform === 'win32',
    });
    if (build.status !== 0) return null;
    const { arccms } = await import(`${pathToFileURL(resolve(ROOT, 'functions/lib/index.js')).href}?t=${Date.now()}`);
    // The app's `custom` group counts only when it has a function in it:
    // targeting an empty group fails the deploy.
    return Object.entries(arccms)
        .filter(([name, value]) => value && (value.__endpoint
            || (name === 'custom' && Object.values(value).some((fn) => fn?.__endpoint))))
        .map(([name]) => name)
        .sort();
}

// ---------------------------------------------------------------------------
// The first-time setup
// ---------------------------------------------------------------------------

/**
 * `arc:configure` flags from the setup answers. `shared`: the project also
 * runs another app (Arc CMS as its backend).
 */
export function setupFlags(projectId, answers) {
    const flags = [`--project=${projectId}`, `--profile=${answers.shared ? 'backend' : 'standalone'}`];
    if (answers.database) flags.push(`--database=${answers.database}`);
    if (answers.site) flags.push(`--site=${answers.site}`);
    if (answers.bucket) flags.push(`--bucket=${answers.bucket}`);
    if (answers.prefix) flags.push(`--prefix=${answers.prefix}`);
    if (answers.appUsers === 'own') flags.push(`--app-users=${APP_USERS_OWN}`);
    if (answers.appUsers === 'host') {
        flags.push(`--app-users-database=${answers.appUsersDatabase || DEFAULT_DATABASE_ID}`);
        flags.push(`--app-users-path=${answers.appUsersPath || OWN_USERS_PATH}`);
    }
    return flags;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

async function choose(rl, question, options, defaultIndex = 0) {
    console.log(`\n${question}`);
    options.forEach((o, i) => console.log(`  ${i + 1}) ${o.label}${i === defaultIndex ? '   (default)' : ''}`));
    for (;;) {
        const answer = (await rl.question(`Choose 1-${options.length} [${defaultIndex + 1}]: `)).trim();
        if (!answer) return options[defaultIndex];
        const n = Number(answer);
        if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
        console.log('Type one of the numbers above, or press Enter for the default.');
    }
}

async function ask(rl, question, fallback = '') {
    const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
    return answer || fallback;
}

async function yes(rl, question, fallback = true) {
    const answer = (await rl.question(`${question} (${fallback ? 'Y/n' : 'y/N'}): `)).trim().toLowerCase();
    return answer ? answer.startsWith('y') : fallback;
}

/** The first-time setup's questions. Returns the answers, or null when stopped. */
export async function askSetup(rl, projectId) {
    console.log(`\n${projectId} has no Arc CMS settings yet. A few questions set it up (you can change them later).`);
    const use = await choose(rl, 'How is this Firebase project used?', [
        { label: 'Only by Arc CMS: its own website or app', shared: false },
        { label: 'Shared with another app: Arc CMS runs next to it, as its admin or backend', shared: true },
    ]);
    const answers = { shared: use.shared };
    if (use.shared) {
        console.log('\nNext to another app, Arc CMS keeps its own database, website and storage, so neither app touches the other\'s.');
        answers.database = await ask(rl, 'Arc CMS database name', 'arccms');
        const site = await choose(rl, 'Arc CMS website', [
            { label: 'Its own site (a second Firebase Hosting site in this project)', value: 'own' },
            { label: 'No website: Arc CMS is the admin only', value: HOSTING_OFF },
        ]);
        answers.site = site.value === 'own' ? await ask(rl, 'Site name', `${projectId}-arccms`) : HOSTING_OFF;
        answers.bucket = await ask(rl, 'Storage bucket for Arc CMS uploads', `${projectId}-arccms`);
        answers.prefix = await ask(rl, 'Folder in it', 'arccms/');
        // The App audience is the other app's users: ask only where they are.
        const path = await ask(rl, 'Where does the other app keep its users? <collection>/{id}, or none', 'users/{id}');
        if (path.toLowerCase() === 'none') {
            answers.appUsers = 'none';
        } else {
            answers.appUsers = 'host';
            answers.appUsersPath = path;
            answers.appUsersDatabase = await ask(rl, 'In which database', DEFAULT_DATABASE_ID);
        }
    } else {
        const site = await yes(rl, 'Publish the website on this project\'s main site?', true);
        if (!site) answers.site = HOSTING_OFF;
        // The App audience is this site's own users: nothing to ask.
        answers.appUsers = 'own';
    }
    return answers;
}

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

function optionHelp() {
    return [
        'npm run deploy with no options asks what to deploy; this is not a terminal, so pass them:',
        '  npm run deploy -- --only functions:arccms --project default        every function',
        '  npm run deploy -- --only functions:arccms:arccms.<name> --project default   one function',
        '  npm run deploy -- --only firestore --project default               database rules and indexes',
        '  npm run deploy -- --only storage --project default                 storage rules',
        '  npm run deploy -- --only hosting --project default                 the website (build it first)',
        'Add --probe to check afterwards that the callables are reachable.',
    ].join('\n');
}

export async function runMenu({ input = process.stdin, output = process.stdout } = {}) {
    if (!input.isTTY) {
        console.log(optionHelp());
        return 1;
    }
    const rl = createInterface({ input, output });
    try {
        return await menu(rl);
    } finally {
        rl.close();
    }
}

async function menu(rl) {
    const state = readState();
    const aliases = readFirebaseAliases();
    const active = cliActiveProject();

    // 1. The project.
    const { options, defaultIndex } = projectOptions(aliases, active, state.lastProject);
    if (!options.length) {
        console.error('No Firebase project here: run firebase use --add first.');
        return 1;
    }
    const project = await choose(rl, 'Which Firebase project?', [...options, { label: 'Another project id', other: true }], defaultIndex);
    const projectId = project.other ? await ask(rl, 'Project id') : project.projectId;
    if (!projectId) return 1;
    const alias = project.other ? '' : project.alias;

    // 2. Its install settings.
    let file = readArcInstallConfig();
    const installText = existsSync(PATHS.install) ? readFileSync(PATHS.install, 'utf8') : '';
    const committed = committedInstallEntry(installText, projectId);
    if (!hasInstallSettings(file, projectId) && !committed) {
        const setUp = await yes(rl, `\n${projectId} has no Arc CMS settings in this checkout. Set it up now?`, true);
        if (setUp) {
            const answers = await askSetup(rl, projectId);
            if (configure(setupFlags(projectId, answers)) !== 0) return 1;
            if (answers.shared) {
                // A deploy would create a missing database itself, in the project's
                // default location: create the resources first, where they belong.
                console.log('\nCreate the resources above first (the database in the same location as the other app), then run npm run deploy again.');
                console.log('Commit src/environments/arc-install.ts too: the website reads it.');
                return 0;
            }
            file = readArcInstallConfig();
        } else {
            console.log('It deploys as a standalone site on the (default) database.');
        }
    }
    const settings = hasInstallSettings(file, projectId) ? normalizeConfig(configForProject(file, projectId)) : null;
    const problems = installProblems({ projectId, settings, committed });
    if (problems.length) {
        for (const problem of problems) console.error(`\n${problem}`);
        console.error('Nothing was deployed.');
        return 1;
    }
    if (settings) {
        // Rebuild the generated files from arccms.config.json, so they are never stale.
        const before = installText;
        const messages = [];
        if (configure([`--project=${projectId}`], PATHS, (line) => messages.push(line)) !== 0) {
            console.error(messages.join('\n'));
            return 1;
        }
        if (existsSync(PATHS.install) && readFileSync(PATHS.install, 'utf8') !== before) {
            console.log('\nsrc/environments/arc-install.ts was updated from arccms.config.json. Commit it with this deploy.');
        }
    }
    const config = settings ?? normalizeConfig({});
    console.log(`\n${projectId}`);
    for (const line of installSummary(config)) console.log(`  ${line}`);

    // 3. What to deploy.
    const history = state.deployed?.[projectId] ?? {};
    const head = gitHead();
    const sinceFunctions = changedFilesSince(history.functions?.commit);
    console.log('\nBuilding the functions to see what changed...');
    const deployable = await deployableFunctions();
    if (!deployable) {
        console.error('The functions build failed, so nothing was deployed. Run npm run build --prefix functions to see why.');
        return 1;
    }
    let changed = null;
    if (sinceFunctions) {
        const graph = functionsGraph(sourceFiles(FUNCTIONS_SRC).map((path) => [relative(FUNCTIONS_SRC, path), readFileSync(path, 'utf8')]));
        const affected = affectedFunctions({ graph, changed: sinceFunctions, deployable, previous: history.functions?.names });
        changed = affected.all ? null : { names: affected.names, targets: functionTargets(affected.names) };
        if (affected.all) console.log('A change affects every function (dependencies or settings), so "All functions" is the one to pick.');
        else if (!affected.names.length) console.log('No function changed since the last deploy from this checkout.');
        const removed = (history.functions?.names ?? []).filter((name) => !deployable.includes(name));
        if (removed.length) console.log(`Removed from the code since then: ${removed.join(', ')}. "All functions" deletes them from the project.`);
    } else {
        console.log('No earlier functions deploy from this checkout to compare with, so the changed-functions choice is not offered.');
    }
    const dirty = {};
    for (const [key, patterns] of Object.entries(TARGET_PATHS)) {
        const since = changedFilesSince(history[key]?.commit);
        dirty[key] = !!since && since.some((path) => patterns.some((re) => re.test(path)));
    }
    const websiteOn = config.hostingSite !== HOSTING_OFF;
    const websiteBuild = WEBSITE_BUILDS[alias];
    if (websiteOn && !websiteBuild) console.log(`The website is deployed with npm run deploy:dev or deploy:prod; ${alias || projectId} has no website build set up.`);
    const storageOn = !sharesDefaultBucket(config);
    if (!storageOn) console.log('Storage rules are not offered: Arc CMS shares the default bucket with the other app, and a bucket has one rules file (docs/operations/deploy.html).');
    const choices = deployChoices({ websiteOn, websiteBuild, changed, dirty, storageOn });
    const lastKey = state.choice?.[projectId];
    const preferred = Math.max(0, choices.findIndex((c) => c.key === lastKey));
    const choice = await choose(rl, 'What to deploy?', choices, lastKey ? preferred : 0);

    // The functions run next to the database: set on a first deploy, a warning after.
    if (choice.only.some((target) => target.startsWith('functions'))) {
        const region = checkFunctionsRegion(projectId);
        if (!region.proceed) return 1;
        if (region.decision.kind === 'warn' && !readState().regionWarningOff?.[projectId]
            && !(await yes(rl, 'Warn about this on every deploy to this project?', true))) {
            const latest = readState();
            writeState({ ...latest, regionWarningOff: { ...latest.regionWarningOff, [projectId]: true } });
        }
    }

    // 4. Confirm.
    const generated = existsSync(generatedConfigPath(projectId));
    const args = ['--only', choice.only.join(','), '--project', projectId];
    console.log('\nAbout to deploy');
    console.log(`  Project:  ${project.other ? projectId : project.label}`);
    console.log(`  Config:   ${generated ? relative(ROOT, generatedConfigPath(projectId)) : 'firebase.json'}`);
    console.log(`  What:     ${choice.label}`);
    if (choice.website) console.log(`  First:    build the website (${Object.keys(websiteBuild.env).length ? 'dev' : 'production'} settings); after: publish its static pages`);
    console.log(`  Command:  npm run deploy -- ${args.join(' ')}`);
    if (needsTypedConfirmation(alias, projectId)) {
        const typed = await ask(rl, `\nThis is ${projectId}. Type the project id to deploy`);
        if (typed !== projectId) {
            console.log('Not deployed.');
            return 1;
        }
    } else if (!(await yes(rl, '\nDeploy?', true))) {
        console.log('Not deployed.');
        return 1;
    }

    // 5. Deploy.
    if (choice.website) {
        console.log('\n> npm run build (the website)');
        const build = spawnSync('npm', ['run', 'build'], {
            cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...websiteBuild.env },
        });
        if (build.status !== 0) {
            console.error('\nThe website build failed, so nothing was deployed.');
            return build.status ?? 1;
        }
    }
    // The functions were built above, to see what changed. A deploy of all the
    // functions lists any it would delete and asks here, on the menu's prompt.
    const result = await runDeploy(args, {
        built: true, record: false, isTTY: true, regionChecked: true,
        ask: async () => ((await yes(rl, 'Delete them?', false)) ? 'y' : 'n'),
        askSignInSetup: async () => ((await yes(rl, 'Set it up now?', true)) ? 'y' : 'n'),
    });
    // Only a newly created callable can be left unreachable: check just those.
    const newCallables = result.created.filter((name) => callableNames().has(name));
    if (result.status === 0 && newCallables.length) {
        const check = spawnSync('bash', [resolve(ROOT, 'functions/scripts/check-callable-access.sh'), ...newCallables], {
            stdio: 'inherit', env: { ...process.env, FIREBASE_PROJECT: projectId, FIREBASE_REGION: functionsRegionOf(projectId) },
        });
        if (check.status !== 0) {
            console.error('\nA new callable is blocked. Delete it and deploy again (a fresh create grants access).');
            return check.status ?? 1;
        }
    }
    if (result.status === 0 && choice.website) {
        spawnSync('node', [resolve(ROOT, 'functions/scripts/call-seed.cjs'), websiteBuild.seed], { stdio: 'inherit' });
    }

    // 6. Remember.
    if (result.status === 0) {
        const record = { commit: head, at: new Date().toISOString() };
        const parts = choice.key === 'changed' ? ['functions'] : deployedParts(choice.only.join(','));
        // Read again: the region check may have remembered things since the start.
        const latest = readState();
        const next = recordDeploy(latest, projectId, parts, parts.includes('functions') ? { ...record, names: deployable } : record);
        writeState({ ...next, lastProject: projectId, choice: { ...latest.choice, [projectId]: choice.key } });
        console.log(`\nDone: ${choice.label} on ${projectId}.`);
    }
    return result.status;
}

/** Callables, by the names the access check takes: onCall exports, and the app's listed ones as custom-<name>. */
function callableNames() {
    const names = new Set();
    for (const path of sourceFiles(FUNCTIONS_SRC)) {
        for (const match of readFileSync(path, 'utf8').matchAll(/export const (\w+)\s*=\s*onCall\s*(?:<[^>]*>)?\s*\(/g)) names.add(match[1]);
    }
    const custom = resolve(FUNCTIONS_SRC, 'custom/public-callables.txt');
    if (existsSync(custom)) {
        for (const line of readFileSync(custom, 'utf8').split('\n')) {
            const name = line.replace(/#.*/, '').trim();
            if (name) names.add(`custom-${name}`);
        }
    }
    return names;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await runMenu();
}
