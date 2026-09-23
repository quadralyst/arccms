/**
 * Reads the optional install config, `arccms.config.json` at the repo root
 * (docs/coexistence-spec.md, CO-D3). Shared by the Node scripts in this folder.
 *
 * No file means every default, which is how every install ran before CO2:
 * the `(default)` Firestore database, the project's default bucket and hosting site.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DATABASE_ID = '(default)';
export const CONFIG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'arccms.config.json');

/** The parsed file, or `{}` when there is none. Throws on a file that is not valid JSON. */
export function readArcInstallConfig(path = CONFIG_PATH) {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${path} must hold a JSON object.`);
    }
    return parsed;
}

/** The Firestore database the install uses. */
export function arcDatabaseId(config = readArcInstallConfig()) {
    return (typeof config.databaseId === 'string' && config.databaseId.trim()) || DEFAULT_DATABASE_ID;
}
