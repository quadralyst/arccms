/**
 * Which Firebase web settings a build uses (specs/app-project-settings-spec.md, E-D3 to E-D5).
 *
 *   ARC_PROJECT=staging npm run build      (or any alias or project id)
 *
 * vite.config.ts swaps src/environments/environment.ts for the file this returns:
 *
 * - the project's own generated file, src/environments/firebase-web.<id>.ts, written by
 *   `npm run arc:configure -- --project=<alias> --web-config=fetch`;
 * - else the old environment file: environment.prod.ts for the `production` alias,
 *   environment.ts for any other, but only if it names that very project. A site that
 *   would talk to another project is never built.
 *
 * With no ARC_PROJECT nothing here runs and the build works as it always did.
 */
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { ROOT, readFirebaseAliases, resolveProjectId, webConfigPath } from './arc-install-config.mjs';

/** The project id an environment file names, or ''. */
export function projectIdIn(text) {
    return /projectId:\s*['"]([^'"]+)['"]/.exec(text ?? '')?.[1] ?? '';
}

/** `{ projectId, file, source }` for a build of this project. Throws with the fix when there are no settings. */
export function environmentFor(aliasOrId, { root = ROOT, aliases = readFirebaseAliases(resolve(root, '.firebaserc')) } = {}) {
    const projectId = resolveProjectId(aliasOrId, aliases);
    if (!projectId) throw new Error(`ARC_PROJECT=${aliasOrId}: no such alias in .firebaserc, and no project id.`);
    const generated = webConfigPath(projectId, root);
    if (existsSync(generated)) return { projectId, file: generated, source: 'generated' };

    const fallback = resolve(root, 'src/environments', aliases.production === projectId ? 'environment.prod.ts' : 'environment.ts');
    const named = existsSync(fallback) ? projectIdIn(readFileSync(fallback, 'utf8')) : '';
    if (named !== projectId) {
        throw new Error(`No web settings for ${projectId}: ${relative(root, fallback)} is for ${named || 'no project'}, so the site would talk to the wrong project. `
            + `Add them with: npm run arc:configure -- --project=${aliasOrId} --web-config=fetch`);
    }
    return { projectId, file: fallback, source: 'environment file' };
}
