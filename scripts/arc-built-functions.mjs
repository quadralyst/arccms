/**
 * The functions in the current build (functions/lib), the `arccms` group as
 * index.js exports it. Its own module: a dynamic import in a script that starts
 * with a #! line breaks the test runner's transform.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './arc-install-config.mjs';

export async function builtArccms() {
    const { arccms } = await import(`${pathToFileURL(resolve(ROOT, 'functions/lib/index.js')).href}?t=${Date.now()}`);
    return arccms;
}

/**
 * Whether a build export is a function Firebase deploys. It asks only whether
 * Firebase marked it, never reads the mark: a first generation function's
 * `__endpoint` is a getter that throws outside Firebase when GCLOUD_PROJECT is
 * not set (onSignInDeleted, an Auth trigger).
 */
export function isCloudFunction(value) {
    return typeof value === 'function' && '__endpoint' in value;
}

/**
 * A second generation function's endpoint, or null. Firebase sets it as a plain
 * value on those; on a first generation function it is the getter that throws,
 * so that one is never read.
 */
export function v2Endpoint(value) {
    if (!isCloudFunction(value)) return null;
    const own = Object.getOwnPropertyDescriptor(value, '__endpoint');
    return own && 'value' in own ? own.value : null;
}

/**
 * The callables in a build group, by the plain name the callable check takes:
 * nested groups joined with `-` (`custom-hello`). Only second generation ones:
 * Arc CMS has no first generation callable.
 */
export function callableNames(group, prefix = '') {
    return Object.entries(group ?? {}).flatMap(([key, value]) => {
        if (isCloudFunction(value)) return v2Endpoint(value)?.callableTrigger ? [prefix + key] : [];
        if (value && typeof value === 'object' && !Array.isArray(value)) return callableNames(value, `${prefix}${key}-`);
        return [];
    });
}
