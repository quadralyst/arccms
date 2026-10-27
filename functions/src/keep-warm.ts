/**
 * Keeping instances of chosen functions running on a project, so their first call of
 * the day has no cold start (docs/app/functions.html#keep-warm).
 *
 *     # functions/.env.YOUR_PROJECT
 *     ARC_KEEP_WARM=signInWithPin,custom-pinSignIn
 *
 * Names are the ones the browser calls (`signInWithPin`, `custom-` and the name for the
 * app's own), each with `:2` or more for more than one instance. Google bills a kept
 * instance all the time, so it is off unless set, and set per project.
 *
 * Read when the functions are deployed. Firebase reads what to deploy without the
 * project's .env values, so the setting comes from the file itself: the process's
 * environment first (a CI job), then functions/.env.<project>, then functions/.env.
 */
import { readFileSync } from 'node:fs';

export const KEEP_WARM_KEY = 'ARC_KEEP_WARM';
/** More than this many kept instances of one function is surely a typing mistake. */
export const MAX_KEPT = 10;

/** How many instances to keep of each named function; a mistake throws, which stops the deploy. */
export function parseKeepWarm(value: string | undefined): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of (value ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
        const match = /^([\w-]+)(?::(\d+))?$/.exec(item);
        const count = match ? Number(match[2] ?? 1) : NaN;
        if (!match || !Number.isInteger(count) || count < 1 || count > MAX_KEPT) {
            throw new Error(
                `${KEEP_WARM_KEY}: "${item}" is not a function name with an optional count from 1 to ${MAX_KEPT}, ` +
                    `such as signInWithPin or custom-pinSignIn:2.`,
            );
        }
        counts.set(match[1], count);
    }
    return counts;
}

/** ARC_KEEP_WARM's value in a .env file's text, or undefined. */
export function envFileValue(text: string, key = KEEP_WARM_KEY): string | undefined {
    let value: string | undefined;
    for (const line of text.split(/\r?\n/)) {
        const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`).exec(line);
        if (match) value = match[1].replace(/^(['"])(.*)\1$/, '$2');
    }
    return value;
}

/** The setting for this deploy: the environment, then functions/.env.<project>, then functions/.env. */
export function keepWarmSetting(
    env: Record<string, string | undefined> = process.env,
    read: (file: string) => string | null = readFunctionsFile,
): string | undefined {
    if (env[KEEP_WARM_KEY] !== undefined) return env[KEEP_WARM_KEY];
    const project = env['GCLOUD_PROJECT'];
    for (const file of [...(project ? [`.env.${project}`] : []), '.env']) {
        const text = read(file);
        const value = text === null ? undefined : envFileValue(text);
        if (value !== undefined) return value;
    }
    return undefined;
}

/** A file in functions/, beside lib/, or null. */
function readFunctionsFile(file: string): string | null {
    try {
        return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    } catch {
        return null;
    }
}

/**
 * Sets minInstances on the named second generation functions of a build group, by the
 * name the browser calls (nested groups joined with `-`). Returns the names it did not
 * find, such as a function of a feature that is off.
 */
export function applyKeepWarm(group: Record<string, unknown>, counts: Map<string, number>): string[] {
    const found = new Set<string>();
    const visit = (node: Record<string, unknown>, prefix: string) => {
        for (const [key, value] of Object.entries(node)) {
            const name = prefix + key;
            const own = typeof value === 'function' ? Object.getOwnPropertyDescriptor(value, '__endpoint') : undefined;
            if (own && 'value' in own) {
                const endpoint = own.value as { platform?: string; minInstances?: unknown };
                if (counts.has(name) && endpoint?.platform === 'gcfv2') {
                    endpoint.minInstances = counts.get(name);
                    found.add(name);
                }
            } else if (value && typeof value === 'object' && !Array.isArray(value)) {
                visit(value as Record<string, unknown>, `${name}-`);
            }
        }
    };
    visit(group, '');
    return [...counts.keys()].filter((name) => !found.has(name));
}
