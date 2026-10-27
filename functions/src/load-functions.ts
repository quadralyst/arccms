/**
 * Which code a function instance loads as it starts (docs/app/functions.html#cold-starts).
 *
 * Every function deploys from the same build, and Google starts each one by loading
 * index.js. Loading every function's code there (all.js) makes each cold start pay for
 * all of them: core's, the features' and the app's. So an instance that serves one
 * function loads only the file that defines it, found in function-map.json, which
 * scripts/arc-function-map.mjs writes into the build after it is compiled. Firebase
 * names the function in FUNCTION_TARGET (`arccms.signInWithPin`,
 * `arccms.custom.completeLesson`).
 *
 * Everything else gets every function, as before: a deploy reading what to deploy, the
 * scripts that read the build, tests, and an instance whose function the map does not
 * name (a build without the map, or a map from another build).
 */
import { readFileSync } from 'node:fs';
import { ARC_FUNCTION_GROUP } from './function-names.js';

/** The map's file name, beside index.js in the build. */
export const FUNCTION_MAP_FILE = 'function-map.json';

/**
 * Each function, by its path inside the `arccms` group (`signInWithPin`,
 * `custom.completeLesson`), and where it is defined: the file, from the build's root,
 * and the name it is exported with there.
 */
export interface FunctionMap {
    functions: Record<string, [file: string, exportName: string]>;
}

/** The function an instance serves, inside the group (`signInWithPin`, `custom.hello`); null when it is not one of ours. */
export function targetPath(target: string | undefined): string | null {
    const prefix = `${ARC_FUNCTION_GROUP}.`;
    if (!target?.startsWith(prefix)) return null;
    const path = target.slice(prefix.length);
    return /^[\w$]+(\.[\w$]+)*$/.test(path) ? path : null;
}

/** The map in the build, or null when there is none or it cannot be read. */
export function readFunctionMap(url = new URL(`./${FUNCTION_MAP_FILE}`, import.meta.url)): FunctionMap | null {
    try {
        const map = JSON.parse(readFileSync(url, 'utf8')) as FunctionMap;
        return map && typeof map.functions === 'object' ? map : null;
    } catch {
        return null;
    }
}

type Loader = (file: string) => Promise<Record<string, unknown>>;

// A path relative to this file, not a URL from import.meta.url, which a test runner may rewrite.
const fromBuild: Loader = (file) => import(`./${file}`);

/**
 * The `arccms` group for this instance: only its own function, nested as Firebase
 * names it, when FUNCTION_TARGET names one the map knows; otherwise every function.
 */
export async function loadFunctions(
    target: string | undefined = process.env.FUNCTION_TARGET,
    map: FunctionMap | null = target ? readFunctionMap() : null,
    load: Loader = fromBuild,
): Promise<Record<string, unknown>> {
    const path = targetPath(target);
    const place = path ? map?.functions[path] : undefined;
    if (path && place) {
        const [file, exportName] = place;
        const code = await load(file);
        if (exportName in code) return nest(path.split('.'), code[exportName]);
        console.warn(`${FUNCTION_MAP_FILE} says ${path} is ${exportName} in ${file}, which does not export it: loading every function.`);
    } else if (path && map) {
        console.warn(`${FUNCTION_MAP_FILE} does not list ${path}: loading every function.`);
    }
    return load('all.js');
}

/** `{ a: { b: value } }` for ['a', 'b']. */
function nest(path: string[], value: unknown): Record<string, unknown> {
    return path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Record<string, unknown>;
}
