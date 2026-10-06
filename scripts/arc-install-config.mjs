/**
 * Reads the optional install config, `arccms.config.json` at the repo root
 * (specs/coexistence-spec.md, CO-D3, CO3.2). Shared by the Node scripts here.
 *
 * One checkout can deploy to several Firebase projects (dev, production, a test
 * project), and each can be set up differently, so the file holds settings per
 * project:
 *
 *   {
 *     "profile": "standalone",                        // shared by every project
 *     "projects": {
 *       "xlm-project-864ff": { "databaseId": "arccms" } // this project only
 *     }
 *   }
 *
 * Top-level keys apply to every project; `projects.<projectId>` overrides them.
 * A file written before CO3.2 (only top-level keys) still works that way. No
 * file means every default, which is how every install ran before CO2.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_DATABASE_ID = '(default)';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = resolve(ROOT, 'arccms.config.json');
export const FIREBASERC_PATH = resolve(ROOT, '.firebaserc');

/** The parsed file, or `{}` when there is none. Throws on a file that is not valid JSON. */
export function readArcInstallConfig(path = CONFIG_PATH) {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${path} must hold a JSON object.`);
    }
    return parsed;
}

/** The settings for one project: the shared top-level keys, overridden by `projects[projectId]`. */
export function configForProject(file, projectId) {
    const { projects, ...shared } = file ?? {};
    const own = projectId && projects && typeof projects === 'object' ? projects[projectId] : undefined;
    return { ...shared, ...(own && typeof own === 'object' ? own : {}) };
}

/** `.firebaserc` project aliases, `{ alias: projectId }`. */
export function readFirebaseAliases(path = FIREBASERC_PATH) {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8'))?.projects ?? {};
}

/**
 * A project id from what the Firebase CLI accepts: an alias from `.firebaserc`
 * or the id itself. With nothing given, the `default` alias, as the CLI does.
 */
export function resolveProjectId(aliasOrId, aliases = readFirebaseAliases()) {
    const wanted = aliasOrId || 'default';
    return aliases[wanted] || (aliasOrId ? aliasOrId : '');
}

/**
 * A project's Firebase web settings (specs/app-project-settings-spec.md, E-D1): entered
 * once in arccms.config.json under `projects.<id>.firebaseConfig`, written by
 * arc:configure to this committed file, which only a build for that project imports.
 */
export function webConfigPath(projectId, root = ROOT) {
    return resolve(root, `src/environments/firebase-web.${projectId}.ts`);
}

/** The web settings keys kept, and the ones a build cannot do without. */
export const WEB_CONFIG_KEYS = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
export const REQUIRED_WEB_CONFIG_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];

/** Whether the install config marks a project as production (`"production": "yes"`, E-D9). */
export function isMarkedProduction(file, projectId) {
    const value = configForProject(file, projectId).production;
    return value === 'yes' || value === true;
}

/** The Firestore database a project uses. */
export function arcDatabaseId(config) {
    return (typeof config?.databaseId === 'string' && config.databaseId.trim()) || DEFAULT_DATABASE_ID;
}

/** The Firestore database for a project (alias or id), from the install config. */
export function arcDatabaseIdFor(aliasOrId, file = readArcInstallConfig(), aliases = readFirebaseAliases()) {
    return arcDatabaseId(configForProject(file, resolveProjectId(aliasOrId, aliases)));
}

// `node scripts/arc-install-config.mjs --database-id [--project=<alias or id>]`
// prints that project's database id, for npm scripts that pass it to the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--database-id')) {
    const projectArg = process.argv.find((a) => a.startsWith('--project='));
    process.stdout.write(arcDatabaseIdFor(projectArg?.slice('--project='.length)));
}
