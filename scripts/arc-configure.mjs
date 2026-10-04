#!/usr/bin/env node
/**
 * npm run arc:configure -- [--project=<alias or id>] [flags]
 *
 * Turns `arccms.config.json` into the files that need its values, for one
 * Firebase project at a time (specs/coexistence-spec.md, CO-D3, CO3.2):
 *
 *   src/environments/arc-install.ts   every project's database, bucket and upload
 *                                     folder, keyed by project id; the app picks
 *                                     its own by firebaseConfig.projectId
 *   functions/.env.<projectId>        ARC_DATABASE_ID, ARC_FUNCTIONS_REGION, ARC_HOSTING_SITE, ARC_STORAGE_* for that
 *                                     project (other lines kept); the committed
 *                                     functions/.env stays the default
 *   firebase.<projectId>.json         Firebase CLI config for a named database, own
 *                                     bucket or own hosting site; removed when the
 *                                     project uses none, so plain firebase.json applies
 *
 * The project is an alias from .firebaserc or a project id; without --project
 * it is the `default` alias, as with the Firebase CLI.
 *
 * Flags update that project's entry in arccms.config.json first:
 *   --profile=standalone|backend  --database=<id>  --site=<hosting site | none>
 *   --bucket=<bucket>  --prefix=<upload folder>  --region=<location>
 *   --functions-region=<region>   where the functions run; set by the first functions
 *                     deploy to the database's region (scripts/arc-region.mjs), and
 *                     from --region when that is given
 *   --app-users-database=<db>  --app-users-path=<collection>/{id}   the host app's users (CO6)
 *   --app-users=own   the audience is this install's own users collection (CO6.8), for a
 *                     standalone site or an app built on ArcCMS; sets the two flags above
 *   --admin-only-sign-in=yes|no   onboarding turns sign-ups off (CO6.6; default yes for backend)
 *   --dry-run   print what would change, write nothing
 *
 * With no arccms.config.json and no flags, every output is the default and a
 * standalone install is left exactly as it was.
 *
 * The script never creates cloud resources. For a backend profile it prints the
 * commands that create the database, hosting site and bucket.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    DEFAULT_DATABASE_ID, configForProject, readFirebaseAliases, resolveProjectId,
} from './arc-install-config.mjs';
import { DEFAULT_FUNCTIONS_REGION, functionsRegionFor } from './arc-region.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PATHS = {
    config: resolve(ROOT, 'arccms.config.json'),
    firebase: resolve(ROOT, 'firebase.json'),
    firebaserc: resolve(ROOT, '.firebaserc'),
    root: ROOT,
    install: resolve(ROOT, 'src/environments/arc-install.ts'),
    functionsDir: resolve(ROOT, 'functions'),
};

/** The generated Firebase CLI config for a project. */
export function generatedFirebasePath(projectId, root = ROOT) {
    return resolve(root, `firebase.${projectId}.json`);
}

const PROFILES = ['standalone', 'backend'];
const FLAG_KEYS = {
    profile: 'profile',
    database: 'databaseId',
    site: 'hostingSite',
    bucket: 'storageBucket',
    prefix: 'storagePrefix',
    region: 'region',
    'functions-region': 'functionsRegion',
    'app-users-database': 'appUsersDatabase',
    'app-users-path': 'appUsersPath',
    'admin-only-sign-in': 'adminOnlySignIn',
    'app-users': 'appUsers',
};

/** When no host collection is configured: a path nothing writes to (App audience, CO6). */
export const APP_USERS_UNCONFIGURED = '_arccms_app_users_not_configured/{id}';
/** `--app-users=own`: this install's own users are the App audience (CO6.8). */
export const APP_USERS_OWN = 'own';
export const OWN_USERS_PATH = 'users/{id}';
const APP_USERS_PATH_PATTERN = /^([A-Za-z0-9_-]+)\/\{([A-Za-z0-9_]+)\}$/;

/** `--database=arccms` style flags → config keys. Unknown flags throw. */
export function parseFlags(argv) {
    const updates = {};
    let dryRun = false;
    let project = '';
    for (const arg of argv) {
        if (arg === '--dry-run') { dryRun = true; continue; }
        if (arg.startsWith('--project=')) { project = arg.slice('--project='.length); continue; }
        const match = /^--([a-z-]+)=(.*)$/.exec(arg);
        if (!match || !(match[1] in FLAG_KEYS)) throw new Error(`Unknown argument: ${arg}`);
        updates[FLAG_KEYS[match[1]]] = match[2];
    }
    return { updates, dryRun, project };
}

/** Trims values, drops blanks and fills the profile default. */
export function normalizeConfig(raw) {
    const config = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed) config[key] = trimmed;
    }
    if (config.storageBucket) config.storageBucket = config.storageBucket.replace(/^gs:\/\//, '').replace(/\/+$/, '');
    config.profile = config.profile ?? 'standalone';
    // Admin-only sign-in (CO6.6): on by default for a backend install, whose
    // sign-in pool is shared with the host app's users.
    config.adminOnlySignIn = config.adminOnlySignIn ?? (config.profile === 'backend' ? 'yes' : 'no');
    // `--app-users=own` (CO6.8): the App audience is ArcCMS's own users, in its
    // own database, which follows databaseId if that changes later.
    if (config.appUsers === APP_USERS_OWN) {
        config.appUsersDatabase = config.databaseId || DEFAULT_DATABASE_ID;
        config.appUsersPath = OWN_USERS_PATH;
    }
    // The functions go next to the database: a database location given for the
    // setup commands chooses their region too, unless one is set.
    if (!config.functionsRegion && config.region) {
        const near = functionsRegionFor(config.region);
        if (near) config.functionsRegion = near;
    }
    return config;
}

/** Problems that make the config unsafe to deploy. Empty when it is fine. */
export function validateConfig(config) {
    const errors = [];
    if (!PROFILES.includes(config.profile)) {
        errors.push(`profile must be one of ${PROFILES.join(', ')}, not "${config.profile}".`);
    }
    if (config.adminOnlySignIn && !['yes', 'no'].includes(config.adminOnlySignIn)) {
        errors.push(`admin-only-sign-in must be yes or no, not "${config.adminOnlySignIn}".`);
    }
    if (config.profile === 'backend') {
        // CO-D11: sharing (default) with another app means sharing its rules,
        // indexes and triggers, which is the conflict this whole setup avoids.
        if (!config.databaseId || config.databaseId === DEFAULT_DATABASE_ID) {
            errors.push('A backend install shares its project, so it needs its own database: set databaseId (for example "arccms"), not "(default)".');
        }
        if (!config.hostingSite) errors.push('A backend install needs its own hosting site: set hostingSite.');
        // CO-D9: storage rules are one file per bucket.
        if (!config.storageBucket) errors.push('A backend install needs its own storage bucket: set storageBucket.');
    }
    if (config.appUsersPath && config.appUsersPath !== APP_USERS_UNCONFIGURED) {
        const match = APP_USERS_PATH_PATTERN.exec(config.appUsersPath);
        if (!match) {
            errors.push(`app-users-path "${config.appUsersPath}" must look like <collection>/{id}, for example users/{uid}.`);
        }
    }
    if (config.appUsers && config.appUsers !== APP_USERS_OWN) {
        errors.push(`app-users must be "own" (this install's own users), not "${config.appUsers}". For another app's users, use --app-users-database and --app-users-path.`);
    }
    // One folder, ending in a slash: the storage rules keep `users/` private only
    // at the bucket root or one folder down (review F). `arccms` (no slash) would
    // put uploads in `arccmsusers/...`; `sites/arccms/` would make them public.
    if (config.storagePrefix && !/^[A-Za-z0-9_-]+\/$/.test(config.storagePrefix)) {
        errors.push(`prefix "${config.storagePrefix}" must be one folder ending in a slash, for example "arccms/".`);
    }
    if (config.functionsRegion && !/^[a-z]+-[a-z]+[0-9]+$/.test(config.functionsRegion)) {
        errors.push(`functions-region "${config.functionsRegion}" is not a region, such as asia-south1 or us-central1.`);
    }
    if (config.databaseId && !/^(\(default\)|[a-z][a-z0-9-]{2,62})$/.test(config.databaseId)) {
        errors.push(`databaseId "${config.databaseId}" is not a valid Firestore database id (lowercase letters, digits and hyphens, 3 to 63 characters, starting with a letter).`);
    }
    return errors;
}

const isNamedDatabase = (config) => !!config.databaseId && config.databaseId !== DEFAULT_DATABASE_ID;
/** Functions somewhere other than Firebase's default region. */
const ownFunctionsRegion = (config) => !!config.functionsRegion && config.functionsRegion !== DEFAULT_FUNCTIONS_REGION;
/** `--site=none`: the install publishes nothing to Firebase Hosting (CO5). */
export const HOSTING_OFF = 'none';
const ownHostingSite = (config) => !!config.hostingSite && config.hostingSite !== HOSTING_OFF;

/**
 * Arc CMS shares its project with another app (its own database) but keeps its
 * files in the project's default bucket. Firebase takes one storage rules file
 * per bucket, so deploying Arc CMS's would replace the other app's (review F):
 * such an install deploys no storage rules. Give it a bucket of its own
 * (`--bucket`) to deploy them.
 */
export const sharesDefaultBucket = (config) => isNamedDatabase(config) && !config.storageBucket;

/** The values the app needs for one project, or null when it uses only defaults. */
export function appValues(config) {
    const values = {};
    if (isNamedDatabase(config)) values.databaseId = config.databaseId;
    if (config.storageBucket) values.storageBucket = config.storageBucket;
    if (config.storagePrefix) values.storagePrefix = config.storagePrefix;
    if (config.adminOnlySignIn === 'yes') values.adminOnlySignIn = true;
    if (ownFunctionsRegion(config)) values.functionsRegion = config.functionsRegion;
    // The admin compares local site files with this site's (docs/website/home-page.html).
    if (config.hostingSite) values.hostingSite = config.hostingSite;
    return Object.keys(values).length ? values : null;
}

/**
 * Contents of src/environments/arc-install.ts: an entry per project that uses
 * anything but defaults. `byProject` maps project id to its resolved config.
 */
export function renderArcInstall(byProject = {}) {
    const entries = Object.entries(byProject)
        .map(([projectId, config]) => [projectId, appValues(config)])
        .filter(([, values]) => values)
        .sort(([a], [b]) => a.localeCompare(b));
    const body = entries.length === 0
        ? '{}'
        : `{\n${entries.map(([projectId, values]) =>
            `    ${JSON.stringify(projectId)}: {\n${Object.entries(values).map(([k, v]) => `        ${k}: ${JSON.stringify(v)},`).join('\n')}\n    },`).join('\n')}\n}`;
    return `/**
 * Install configuration for the browser app and SSR, per Firebase project
 * (specs/coexistence-spec.md, CO-D3, CO3.2).
 *
 * Written by \`npm run arc:configure\` from \`arccms.config.json\`; do not edit by hand.
 * The app uses the entry for its own \`firebaseConfig.projectId\`. A project with
 * no entry uses the defaults every standalone install uses: the \`(default)\`
 * Firestore database, the bucket in \`firebaseConfig.storageBucket\`, uploads at
 * the bucket root.
 */
import type { ArcInstallConfig } from '../app/core/config/arc-config';

export const arcInstall: Record<string, ArcInstallConfig> = ${body};
`;
}

/**
 * functions/.env with the ARC_* keys set and every other line kept as it was.
 *
 * ARC_DATABASE_ID and ARC_FUNCTIONS_REGION are always written, defaults included:
 * they back deploy-time params, and the Firebase CLI refuses a non-interactive
 * deploy when a param has no value in a dotenv file, default or not. ARC_HOSTING_SITE is written only
 * when set (its default comes from the project id at run time), and so are
 * ARC_STORAGE_BUCKET and ARC_STORAGE_PREFIX.
 */
export function updateFunctionsEnv(existing, config) {
    const wanted = {
        ARC_DATABASE_ID: config.databaseId || DEFAULT_DATABASE_ID,
        ARC_FUNCTIONS_REGION: config.functionsRegion || DEFAULT_FUNCTIONS_REGION,
        ARC_HOSTING_SITE: config.hostingSite,
        // App audience (CO6): params too, so always written for non-interactive deploys.
        ARC_APP_USERS_DATABASE: config.appUsersDatabase || DEFAULT_DATABASE_ID,
        ARC_APP_USERS_PATH: config.appUsersPath || APP_USERS_UNCONFIGURED,
        // Deleting an account deletes its Storage folder, so the functions need the
        // install's bucket and upload folder too. Written only when set.
        ARC_STORAGE_BUCKET: config.storageBucket,
        ARC_STORAGE_PREFIX: config.storagePrefix,
    };
    const lines = (existing ?? '').split('\n').filter((line) => {
        const key = /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1];
        return !(key && key in wanted);
    });
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const [key, value] of Object.entries(wanted)) {
        if (value) lines.push(`${key}=${value}`);
    }
    return lines.length ? `${lines.join('\n')}\n` : '';
}

/**
 * The Firebase CLI config for this install, derived from the committed
 * firebase.json, or `null` when the install uses only defaults.
 *
 * Hosting off (`--site=none`) removes the `hosting` block entirely (review O2),
 * and so does storage for an install in another app's bucket (sharesDefaultBucket).
 * Keeping it without a site made a full deploy publish ArcCMS to the project's
 * default site, which in a shared project is another app's (on the dev project,
 * the old install's live site). So hosting off always gets a generated config,
 * even when nothing else differs from firebase.json.
 *
 * Functions outside us-central1 put their region on every Hosting rewrite to a
 * function: a rewrite with none looks for the function in us-central1.
 */
export function renderFirebaseConfig(base, config) {
    const hostingOff = config.hostingSite === HOSTING_OFF;
    if (!isNamedDatabase(config) && !config.storageBucket && !ownHostingSite(config) && !hostingOff && !ownFunctionsRegion(config)) return null;
    const out = structuredClone(base);
    if (isNamedDatabase(config)) {
        const firestore = Array.isArray(base.firestore) ? base.firestore[0] : base.firestore;
        out.firestore = [{ database: config.databaseId, ...stripDatabase(firestore) }];
    }
    if (config.storageBucket) {
        const storage = Array.isArray(base.storage) ? base.storage[0] : base.storage;
        out.storage = [{ bucket: config.storageBucket, ...stripBucket(storage) }];
    }
    if (ownHostingSite(config)) {
        out.hosting = { site: config.hostingSite, ...stripSite(base.hosting) };
    }
    if (ownFunctionsRegion(config) && Array.isArray(out.hosting?.rewrites)) {
        out.hosting.rewrites = out.hosting.rewrites.map((rewrite) => (rewrite.function && typeof rewrite.function === 'object'
            ? { ...rewrite, function: { ...rewrite.function, region: config.functionsRegion } }
            : rewrite));
    }
    if (hostingOff) delete out.hosting;
    if (sharesDefaultBucket(config)) delete out.storage;
    return out;
}

function stripDatabase({ database: _ignored, ...rest }) { return rest; }
function stripBucket({ bucket: _ignored, ...rest }) { return rest; }
function stripSite({ site: _ignored, target: _alsoIgnored, ...rest }) { return rest; }

/**
 * The commands that create what a backend install needs. Printed, never run.
 *
 * The Firebase CLI creates a missing named database itself on the first deploy
 * (and, as of CLI 15, even on `deploy --dry-run`), in the project's default
 * location. Creating it first is how the location gets chosen deliberately.
 */
export function setupCommands(config) {
    if (config.profile !== 'backend') return [];
    const location = config.region ?? '<location of the host app, such as nam5 or us-central1>';
    return [
        `firebase firestore:databases:create ${config.databaseId} --location=${location}`,
        ...(ownHostingSite(config) ? [`firebase hosting:sites:create ${config.hostingSite}`] : []),
        `gcloud storage buckets create gs://${config.storageBucket} --location=${location}`,
        `# then link the bucket to Firebase: console, Storage, bucket menu, "Import existing Google Cloud Storage buckets"`,
    ];
}

function readJson(path) {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

function write(path, content, dryRun, changes) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (content === null) {
        if (current !== null) {
            changes.push(`remove ${path}`);
            if (!dryRun) rmSync(path);
        }
        return;
    }
    if (current === content) return;
    changes.push(`${current === null ? 'create' : 'update'} ${path}`);
    if (!dryRun) writeFileSync(path, content);
}

export function main(argv = process.argv.slice(2), paths = PATHS, log = console.log) {
    const { updates, dryRun, project } = parseFlags(argv);
    const aliases = readFirebaseAliases(paths.firebaserc);
    const projectId = resolveProjectId(project, aliases);
    if (!projectId) {
        log('error: no project. Pass --project=<alias or id>, or add a "default" alias to .firebaserc.');
        return 1;
    }

    const stored = readJson(paths.config) ?? {};
    const file = structuredClone(stored);
    if (Object.keys(updates).length) {
        file.projects ??= {};
        file.projects[projectId] = { ...(file.projects[projectId] ?? {}), ...updates };
    }
    const config = normalizeConfig(configForProject(file, projectId));

    const errors = validateConfig(config);
    if (errors.length) {
        for (const error of errors) log(`error: ${error}`);
        return 1;
    }

    const changes = [];
    if (Object.keys(updates).length) {
        write(paths.config, `${JSON.stringify(file, null, 2)}\n`, dryRun, changes);
    }

    // The app gets every configured project at once; it picks its own at run time.
    const byProject = {};
    for (const id of Object.keys(file.projects ?? {})) byProject[id] = normalizeConfig(configForProject(file, id));
    write(paths.install, renderArcInstall(byProject), dryRun, changes);

    const envPath = resolve(paths.functionsDir, `.env.${projectId}`);
    const env = updateFunctionsEnv(existsSync(envPath) ? readFileSync(envPath, 'utf8') : '', config);
    write(envPath, env, dryRun, changes);

    const firebase = renderFirebaseConfig(readJson(paths.firebase), config);
    write(generatedFirebasePath(projectId, paths.root), firebase && `${JSON.stringify(firebase, null, 4)}\n`, dryRun, changes);

    log(`ArcCMS install for ${projectId}: profile ${config.profile}, database ${config.databaseId ?? DEFAULT_DATABASE_ID}`
        + `${config.hostingSite ? `, hosting site ${config.hostingSite}` : ''}`
        + `${config.storageBucket ? `, bucket ${config.storageBucket}` : ''}`
        + `${config.storagePrefix ? `, upload folder ${config.storagePrefix}` : ''}`
        + `${ownFunctionsRegion(config) ? `, functions in ${config.functionsRegion}` : ''}.`);
    log(changes.length ? `${dryRun ? 'Would ' : ''}${changes.join('\n')}` : 'Nothing to change.');
    if (sharesDefaultBucket(config)) {
        log(`\nStorage rules are not deployed for ${projectId}: Arc CMS keeps its files in the default bucket, which the other app uses,`
            + ' and a bucket has one rules file. Give Arc CMS its own bucket (--bucket=<name>) to deploy them (docs/operations/deploy.html).');
    }

    const commands = setupCommands(config);
    if (commands.length) {
        log('\nIf they do not exist yet, create the resources this install uses.');
        log('(A deploy, even with --dry-run, creates a missing database itself in the project\'s default location.)');
        for (const command of commands) log(`  ${command}`);
        log(`\nThen deploy with npm run deploy -- --project ${project || 'default'} (it picks up firebase.${projectId}.json).`);
    }
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        process.exitCode = main();
    } catch (error) {
        console.error(`error: ${error.message}`);
        process.exitCode = 1;
    }
}
