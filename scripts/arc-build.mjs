#!/usr/bin/env node
/**
 * Builds the website for one Firebase project (specs/app-project-settings-spec.md, E-D3):
 *
 *   npm run build:project -- --project=staging      (an alias from .firebaserc, or an id)
 *
 * The same as `ARC_PROJECT=staging npm run build`, on every operating system.
 * `npm run deploy` does this itself before it deploys a website.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, readFirebaseAliases, resolveProjectId } from './arc-install-config.mjs';
import { websiteBuildEnv } from './arc-deploy.mjs';

/** The project id from `--project=<alias or id>`, or '' when there is none. */
export function buildProject(argv, aliases = readFirebaseAliases()) {
    const arg = argv.find((a) => a.startsWith('--project='))?.slice('--project='.length) ?? '';
    return arg ? resolveProjectId(arg, aliases) : '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const projectId = buildProject(process.argv.slice(2));
    if (!projectId) {
        console.error('Which project? npm run build:project -- --project=<alias or id>');
        process.exit(1);
    }
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', env: websiteBuildEnv(projectId) });
    process.exit(build.status ?? 1);
}
