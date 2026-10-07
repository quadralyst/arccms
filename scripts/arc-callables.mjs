/**
 * What functions/scripts/check-callable-access.sh checks (docs/operations/deploy.html,
 * "Check the callables"):
 *
 *   node scripts/arc-callables.mjs target   the project and its functions region, "<id> <region>"
 *   node scripts/arc-callables.mjs names    the callables in the functions build, one per line
 *
 * The project is FIREBASE_PROJECT (an alias or id), else the one a deploy would go
 * to (--project, `firebase use`, the `default` alias); the region is FIREBASE_REGION,
 * else that project's functions region. The build is read without running a first
 * generation function's `__endpoint` getter, which throws when GCLOUD_PROJECT is not
 * set (scripts/arc-built-functions.mjs). When it cannot say, it prints why and exits 2.
 */
import { pathToFileURL } from 'node:url';
import { builtArccms, callableNames } from './arc-built-functions.mjs';
import { deployProject, functionsRegionOf } from './arc-deploy.mjs';
import { readFirebaseAliases, resolveProjectId } from './arc-install-config.mjs';

/** `{ projectId, region }` for the check, or `{ error }`. `deps` replaces the lookups in tests. */
export function checkTarget(env = process.env, deps = {}) {
    const { aliases = readFirebaseAliases(), project = () => deployProject([], aliases), region = functionsRegionOf } = deps;
    const projectId = env.FIREBASE_PROJECT ? resolveProjectId(env.FIREBASE_PROJECT, aliases) : project();
    if (!projectId) {
        return { error: 'No Firebase project to check: set FIREBASE_PROJECT=<alias or id>, run firebase use, or add a "default" alias to .firebaserc.' };
    }
    return { projectId, region: env.FIREBASE_REGION || region(projectId) };
}

/** The callables in the build, or `{ error }` when the build cannot be read. */
export async function builtCallables(read = builtArccms) {
    let group;
    try {
        group = await read();
    } catch (error) {
        return { error: `Could not read the functions build (functions/lib/index.js): ${error.message}` };
    }
    const names = callableNames(group);
    return names.length ? { names } : { error: 'The functions build (functions/lib/index.js) has no callables to check.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const mode = process.argv[2];
    const result = mode === 'target' ? checkTarget() : mode === 'names' ? await builtCallables() : { error: 'Usage: node scripts/arc-callables.mjs target|names' };
    if (result.error) {
        console.error(result.error);
        process.exitCode = 2;
    } else {
        console.log(mode === 'target' ? `${result.projectId} ${result.region}` : result.names.join('\n'));
    }
}
