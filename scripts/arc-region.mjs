/**
 * Where the functions run, next to the database (docs/operations/deploy.html#regions).
 *
 * Every database call a function makes travels to the database's region and
 * back. With the functions in us-central1 (Iowa, the Firebase default) and the
 * database in asia-south1 (Mumbai), a sign-in step that makes a dozen calls
 * takes several seconds (found 2026-09-30). The deploy therefore compares the
 * two before it deploys functions:
 *
 * - no Arc CMS functions deployed yet: nothing to move, so the functions
 *   simply go where the database is (`functionsRegion` in arccms.config.json);
 * - functions already deployed elsewhere: a warning, never a block. Moving a
 *   live install is a deliberate step, not something to do mid-deploy.
 *
 * The database's location never changes, so it is looked up once per project
 * and database and remembered in .arc-deploy-state.json.
 */
import { spawnSync } from 'node:child_process';

/** Where Firebase puts functions that name no region. */
export const DEFAULT_FUNCTIONS_REGION = 'us-central1';

/**
 * Regions Cloud Functions (2nd gen) runs in: `SupportedRegion` in
 * firebase-functions/lib/v2/options.d.ts.
 */
export const FUNCTIONS_REGIONS = new Set([
    'asia-east1', 'asia-east2', 'asia-northeast1', 'asia-northeast2', 'asia-northeast3', 'asia-south1',
    'asia-southeast1', 'asia-southeast2', 'australia-southeast1', 'europe-central2', 'europe-north1',
    'europe-west1', 'europe-west2', 'europe-west3', 'europe-west4', 'europe-west6', 'northamerica-northeast1',
    'southamerica-east1', 'us-central1', 'us-east1', 'us-east4', 'us-west1', 'us-west2', 'us-west3', 'us-west4',
]);

/**
 * Database locations that are not a functions region: the multi-region
 * locations, each with the regions inside it (the first is the one to use), and
 * single regions with no functions, with the nearest region that has them.
 */
const NEAR = {
    nam5: ['us-central1', 'us-east4'],
    nam7: ['us-central1', 'us-east4'],
    eur3: ['europe-west1', 'europe-west4'],
    'asia-south2': ['asia-south1'],
    'australia-southeast2': ['australia-southeast1'],
    'europe-southwest1': ['europe-west1'],
    'europe-west8': ['europe-west1'],
    'europe-west9': ['europe-west1'],
    'europe-west10': ['europe-west3'],
    'europe-west12': ['europe-west1'],
    'northamerica-northeast2': ['northamerica-northeast1'],
    'southamerica-west1': ['southamerica-east1'],
    'us-east5': ['us-east4'],
    'us-south1': ['us-central1'],
};

/** The region functions should run in for a database location, or '' when there is no good one. */
export function functionsRegionFor(location) {
    if (!location) return '';
    if (FUNCTIONS_REGIONS.has(location)) return location;
    return NEAR[location]?.[0] ?? '';
}

/** Whether functions in `region` sit next to a database in `location`. */
export function regionsMatch(location, region) {
    if (!location || !region) return true;
    return location === region || (NEAR[location] ?? []).includes(region);
}

/**
 * What to do before a functions deploy:
 *   ok      the functions are next to the database, or the location is unknown
 *   adopt   nothing deployed yet: run the functions in `suggested`
 *   warn    deployed elsewhere: say so, deploy anyway
 * `deployedArccms`: how many Arc CMS functions the project has, or null when
 * they could not be listed (then it warns rather than moves anything).
 */
export function regionDecision({ location, region, deployedArccms }) {
    const current = region || DEFAULT_FUNCTIONS_REGION;
    if (!location || regionsMatch(location, current)) return { kind: 'ok' };
    const suggested = functionsRegionFor(location);
    if (suggested && deployedArccms === 0) return { kind: 'adopt', location, region: current, suggested };
    return { kind: 'warn', location, region: current, suggested };
}

/** The warning for functions that run far from their database. */
export function regionWarning({ location, region, suggested }, projectId) {
    const fix = suggested
        ? `Functions next to the database (${suggested}) answer in a fraction of that.`
        : `Choose a functions region near ${location} with npm run arc:configure -- --project=${projectId} --functions-region=<region>.`;
    return [
        `Your database is in ${location}, but the functions run in ${region}.`,
        'Every database call a function makes crosses that distance, so each sign-in step and email can take several seconds.',
        fix,
        'See "Regions" in docs/operations/deploy.html.',
    ].join('\n');
}

/**
 * The location of a project's database, from the Firebase CLI, or '' when it
 * cannot say. A database that does not exist yet falls back to the project's
 * `(default)` database, whose location is the project's default: the one a
 * deploy creates a missing database in.
 */
export function lookupDatabaseLocation(projectId, databaseId, run = spawnSync) {
    for (const id of databaseId === '(default)' ? ['(default)'] : [databaseId, '(default)']) {
        const result = run('firebase', ['firestore:databases:get', id, '--project', projectId, '--json'], {
            encoding: 'utf8', shell: process.platform === 'win32',
        });
        try {
            const parsed = JSON.parse(String(result.stdout || ''));
            if (parsed.status === 'success' && parsed.result?.locationId) return parsed.result.locationId;
        } catch { /* try the next one */ }
    }
    return '';
}

/** The location from .arc-deploy-state.json, looked up and remembered when missing. */
export function databaseLocation(state, projectId, databaseId, lookup = lookupDatabaseLocation) {
    const known = state.databaseLocations?.[projectId]?.[databaseId];
    if (known) return { location: known, state };
    const location = lookup(projectId, databaseId);
    if (!location) return { location: '', state };
    const forProject = { ...(state.databaseLocations?.[projectId] ?? {}), [databaseId]: location };
    return { location, state: { ...state, databaseLocations: { ...state.databaseLocations, [projectId]: forProject } } };
}

/** How many of the deployed functions are Arc CMS's, or null when they could not be listed. */
export function countArccms(deployed) {
    if (!deployed) return null;
    return deployed.filter((fn) => (fn.codebase || fn.labels?.['firebase-functions-codebase']) === 'arccms').length;
}
