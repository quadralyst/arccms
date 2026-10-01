/**
 * runAdminScript(fn): run a command-line script with the Firebase Admin SDK against
 * this install's project and database (docs/app/scripts-and-data.html). An app's own
 * scripts in custom/scripts/ use it, and so does `npm run seed:dev`.
 *
 *   import { runAdminScript } from '../../scripts/arc-admin-script.mjs';
 *
 *   runAdminScript(async ({ db, args }) => {
 *       const snap = await db.collection('words').count().get();
 *       console.log(`${snap.data().count} words`);
 *   });
 *
 *   node custom/scripts/count-words.mjs                  the dev project (.firebaserc "default")
 *   node custom/scripts/count-words.mjs --prod           the "production" alias
 *   node custom/scripts/count-words.mjs --project=<id>   any alias or project id
 *
 * What it does, so no script repeats it:
 *   - picks the project from .firebaserc (GCLOUD_PROJECT wins when no flag is given),
 *   - reads the install's ARC_* settings the way a deploy does (functions/scripts/arc-env.cjs),
 *     so `db` is the install's own database, not always `(default)`,
 *   - signs in with GOOGLE_APPLICATION_CREDENTIALS when it is set, otherwise with the
 *     Firebase CLI login through a temporary credentials file, deleted afterwards
 *     even when the script fails or is stopped with Ctrl+C,
 *   - prints the project, database and credentials before the script runs,
 *   - on an error prints it and exits with 1.
 *
 * `db`, `auth` and `storage` start the Admin SDK on first use, so a script that loads
 * code which starts it itself (the seed loads the built functions) never touches them.
 */
import { createRequire } from 'node:module';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadArcEnv } = require('../functions/scripts/arc-env.cjs');

export const DEFAULT_DATABASE_ID = '(default)';

/** The Firebase CLI's public OAuth client (from the firebase-tools package), which issued its refresh token. */
const FIREBASE_CLI_CLIENT = {
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
};

function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * The project to run against and the arguments left for the script. Flags win over
 * GCLOUD_PROJECT, which wins over the `default` alias.
 */
export function resolveTarget(argv, root = ROOT, env = process.env) {
    const aliases = readJson(join(root, '.firebaserc'))?.projects ?? {};
    const args = [];
    let wanted = null;
    for (const arg of argv) {
        if (arg === '--prod') wanted = 'production';
        else if (arg.startsWith('--project=')) wanted = arg.slice('--project='.length);
        else args.push(arg);
    }
    const projectId = wanted ? aliases[wanted] ?? (wanted === 'production' ? '' : wanted) : env.GCLOUD_PROJECT || aliases.default;
    if (!projectId) {
        const alias = wanted ?? 'default';
        throw new Error(`No "${alias}" project in .firebaserc. Add it with: firebase use --add`);
    }
    const prod = projectId === aliases.production;
    return { projectId, prod, args };
}

/** How the Admin SDK signs in: an existing credentials file, or the Firebase CLI login. */
export function findCredentials(env = process.env, home = homedir()) {
    if (env.GOOGLE_APPLICATION_CREDENTIALS) {
        return { label: 'GOOGLE_APPLICATION_CREDENTIALS', refreshToken: null };
    }
    const refreshToken = readJson(join(home, '.config/configstore/firebase-tools.json'))?.tokens?.refresh_token;
    if (!refreshToken) {
        throw new Error('No credentials found. Run `firebase login` first, or set GOOGLE_APPLICATION_CREDENTIALS.');
    }
    return { label: 'your Firebase CLI login', refreshToken };
}

/** The storage bucket the app's environment file names for this project, if any. */
export function storageBucketFor(projectId, root = ROOT) {
    for (const file of ['environment.ts', 'environment.prod.ts']) {
        let text;
        try {
            text = readFileSync(join(root, 'src/environments', file), 'utf8');
        } catch {
            continue;
        }
        if (!text.includes(`projectId: '${projectId}'`)) continue;
        const match = /storageBucket:\s*['"]([^'"]+)['"]/.exec(text);
        if (match) return match[1];
    }
    return undefined;
}

/**
 * Run `fn` against the install's project and database. Resolves to what `fn`
 * returns, or to undefined after printing the error and setting exit code 1.
 */
export async function runAdminScript(fn, options = {}) {
    const {
        argv = process.argv.slice(2),
        root = ROOT,
        env = process.env,
        home = homedir(),
        log = console.log,
        error = console.error,
    } = options;

    let tmpCredentials = null;
    let app = null;
    const removeCredentials = () => {
        if (!tmpCredentials) return;
        rmSync(tmpCredentials, { force: true });
        if (env.GOOGLE_APPLICATION_CREDENTIALS === tmpCredentials) delete env.GOOGLE_APPLICATION_CREDENTIALS;
        tmpCredentials = null;
    };
    const onSigint = () => {
        removeCredentials();
        process.exit(130);
    };
    process.once('exit', removeCredentials);
    process.once('SIGINT', onSigint);

    try {
        const { projectId, prod, args } = resolveTarget(argv, root, env);
        loadArcEnv(join(root, 'functions'), projectId, env);
        const credentials = findCredentials(env, home);
        if (credentials.refreshToken) {
            tmpCredentials = join(tmpdir(), `arc-admin-${process.pid}-${Date.now()}.json`);
            writeFileSync(tmpCredentials, JSON.stringify({
                type: 'authorized_user',
                ...FIREBASE_CLI_CLIENT,
                refresh_token: credentials.refreshToken,
            }), { mode: 0o600 });
            env.GOOGLE_APPLICATION_CREDENTIALS = tmpCredentials;
        }
        const databaseId = env.ARC_DATABASE_ID || DEFAULT_DATABASE_ID;
        const storageBucket = storageBucketFor(projectId, root);
        env.GCLOUD_PROJECT = projectId;
        env.FIREBASE_CONFIG = JSON.stringify(storageBucket ? { projectId, storageBucket } : { projectId });

        log(`  Project:      ${projectId}${prod ? ' (production)' : ''}`);
        log(`  Database:     ${databaseId}`);
        log(`  Credentials:  ${credentials.label}`);
        log('');

        const getApp = () => {
            if (!app) {
                const { initializeApp } = require('firebase-admin/app');
                app = initializeApp({ projectId, ...(storageBucket ? { storageBucket } : {}) }, `arc-admin-script-${Date.now()}`);
            }
            return app;
        };
        const context = {
            projectId,
            databaseId,
            prod,
            args,
            get app() { return getApp(); },
            get db() {
                const { getFirestore } = require('firebase-admin/firestore');
                return databaseId === DEFAULT_DATABASE_ID ? getFirestore(getApp()) : getFirestore(getApp(), databaseId);
            },
            get auth() { return require('firebase-admin/auth').getAuth(getApp()); },
            get storage() { return require('firebase-admin/storage').getStorage(getApp()); },
        };
        return await fn(context);
    } catch (err) {
        error(`\n  Failed: ${err?.message ?? err}`);
        process.exitCode = 1;
        return undefined;
    } finally {
        if (app) await require('firebase-admin/app').deleteApp(app).catch(() => {});
        removeCredentials();
        process.off('exit', removeCredentials);
        process.off('SIGINT', onSigint);
    }
}

// Run directly, it says how to use it rather than doing nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    console.log('Import runAdminScript from this file in a script of your own: see docs/app/scripts-and-data.html.');
}
