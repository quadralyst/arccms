/**
 * Writes functions/lib/function-map.json after the functions are compiled (the
 * functions' `postbuild`): for each function, the file that defines it, so an
 * instance started for one function loads only that file (functions/src/load-functions.ts,
 * docs/app/functions.html#cold-starts).
 *
 *   node scripts/arc-function-map.mjs [functions/lib]
 *
 * It follows the re-exports from all.js down to the files that define functions: a
 * file of nothing but `export ... from` lines (all.js, feature-exports.gen.js, a
 * feature's file, the app's custom/index.js when it is written that way) is followed;
 * any other file is loaded and its functions are mapped to it. Then it checks the map
 * against every function all.js exports: one it missed is said, and still works,
 * loading every function when it starts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MAP_FILE = 'function-map.json';

const REEXPORT = /^export\s+(?:\*\s+as\s+([\w$]+)|(\*)|\{([^}]*)\})\s+from\s+['"]([^'"]+)['"]\s*;?$/;

/** The code of a compiled file, without comments and blank lines, one statement per line. */
function statements(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .split(/;\s*\n|\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith('//# sourceMappingURL='));
}

/** The re-exports of a file made only of them, or null for a file with code of its own. */
export function reexportsOf(text) {
    const found = [];
    for (const line of statements(text)) {
        const match = REEXPORT.exec(line);
        if (!match) return null;
        const [, group, star, names, from] = match;
        const picked = names?.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
            const [name, as] = part.split(/\s+as\s+/);
            return { name: name.trim(), as: (as ?? name).trim() };
        });
        found.push({ group, star: !!star, picked, from });
    }
    return found;
}

/** Whether a build export is a function Firebase deploys (scripts/arc-built-functions.mjs). */
const isCloudFunction = (value) => typeof value === 'function' && '__endpoint' in value;

/**
 * The functions under a file, by dotted path inside the group: [file from libDir, export name].
 * `conflicts` collects paths two files both give, which ES modules leave out of an `export *`.
 */
async function mapFile(libDir, file, prefix, out, conflicts, load, seen = new Set()) {
    const key = `${prefix}|${file}`;
    if (seen.has(key)) return;
    seen.add(key);
    const reexports = reexportsOf(readFileSync(file, 'utf8'));
    if (!reexports) {
        const code = await load(file);
        for (const [name, value] of Object.entries(code)) {
            if (!isCloudFunction(value)) continue;
            add(out, conflicts, prefix + name, [relative(libDir, file).split('\\').join('/'), name]);
        }
        return;
    }
    for (const { group, star, picked, from } of reexports) {
        const target = resolve(dirname(file), from);
        if (!existsSync(target)) continue;
        if (group) {
            await mapFile(libDir, target, `${prefix}${group}.`, out, conflicts, load, seen);
        } else if (star) {
            await mapFile(libDir, target, prefix, out, conflicts, load, seen);
        } else {
            const inner = {};
            await mapFile(libDir, target, '', inner, new Set(), load, new Set());
            for (const { name, as } of picked) {
                if (inner[name]) add(out, conflicts, prefix + as, inner[name]);
            }
        }
    }
}

function add(out, conflicts, path, place) {
    const known = out[path];
    if (known && (known[0] !== place[0] || known[1] !== place[1])) conflicts.add(path);
    else out[path] = place;
}

/** Every function's dotted path in a loaded group. */
export function functionPaths(group, prefix = '') {
    return Object.entries(group ?? {}).flatMap(([key, value]) => {
        if (isCloudFunction(value)) return [prefix + key];
        if (value && typeof value === 'object' && !Array.isArray(value)) return functionPaths(value, `${prefix}${key}.`);
        return [];
    });
}

const loadFromDisk = (file) => import(pathToFileURL(file).href);

/**
 * The map for a build: `{ map: { functions }, missing, conflicts }`. `missing`: functions
 * all.js exports that the map does not place.
 */
export async function buildFunctionMap(libDir, load = loadFromDisk) {
    const all = resolve(libDir, 'all.js');
    const functions = {};
    const conflicts = new Set();
    await mapFile(libDir, all, '', functions, conflicts, load);
    for (const path of conflicts) delete functions[path];
    const exported = functionPaths(await load(all));
    const listed = new Set(exported);
    for (const path of Object.keys(functions)) if (!listed.has(path)) delete functions[path];
    const sorted = Object.fromEntries(Object.entries(functions).sort(([a], [b]) => a.localeCompare(b)));
    return { map: { functions: sorted }, missing: exported.filter((path) => !functions[path]), conflicts: [...conflicts] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const libDir = resolve(process.argv[2] ?? resolve(ROOT, 'functions/lib'));
    // Loading the build reads the install's settings as a deploy does; no project is needed for that.
    process.env.GCLOUD_PROJECT ??= 'arc-function-map';
    delete process.env.FUNCTION_TARGET;
    const { map, missing, conflicts } = await buildFunctionMap(libDir);
    writeFileSync(resolve(libDir, MAP_FILE), `${JSON.stringify(map, null, 1)}\n`);
    console.log(`arc-function-map: ${Object.keys(map.functions).length} functions placed in ${relative(ROOT, resolve(libDir, MAP_FILE))}.`);
    if (missing.length) {
        console.warn(`arc-function-map: these load every function when they start, as the map could not place them: ${missing.join(', ')}.`);
    }
    if (conflicts.length) console.warn(`arc-function-map: exported by two files, so by neither: ${conflicts.join(', ')}.`);
    // The script ends here, though a loaded file may keep a timer or a connection open.
    process.exit(0);
}
