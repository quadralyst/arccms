/**
 * What the guided deploy remembers per checkout, in .arc-deploy-state.json (not
 * committed): the last project and choice, and per project the commit each part
 * was last deployed from, so the next deploy can offer "only what changed".
 * Both deploy paths record it: the menu (arc-deploy-menu.mjs) and a deploy
 * with options (arc-deploy.mjs).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './arc-install-config.mjs';

export const STATE_PATH = resolve(ROOT, '.arc-deploy-state.json');

/** `{ lastProject, choice: {project: key}, deployed: {project: {functions|rules|storage|website: {commit, at, names?}}} }` */
export function readState(path = STATE_PATH) {
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function writeState(state, path = STATE_PATH) {
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** The checked-out commit, or ''. */
export function gitHead() {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : '';
}

/**
 * Which parts a deploy with these `--only` targets brought fully up to date.
 * Single functions do not count: the rest may still be behind. No `--only`
 * (a plain deploy) is everything.
 */
export function deployedParts(only) {
    if (only === null) return ['functions', 'rules', 'storage', 'website'];
    const parts = new Set();
    for (const target of only.split(',').map((t) => t.trim()).filter(Boolean)) {
        if (target === 'functions' || target === 'functions:arccms') parts.add('functions');
        else if (target === 'firestore') parts.add('rules');
        else if (target === 'storage') parts.add('storage');
        else if (target === 'hosting') parts.add('website');
    }
    return [...parts];
}

/** The state with these parts recorded as deployed to a project now. */
export function recordDeploy(state, projectId, parts, record) {
    const deployed = { ...(state.deployed?.[projectId] ?? {}) };
    for (const part of parts) deployed[part] = part === 'functions' && record.names ? record : { commit: record.commit, at: record.at };
    return { ...state, deployed: { ...state.deployed, [projectId]: deployed } };
}
