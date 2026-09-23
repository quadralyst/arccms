/**
 * Install configuration for the browser app and SSR (docs/coexistence-spec.md, CO-D2, CO-D3).
 *
 * Read from `src/environments/arc-install.ts`, which `npm run arc:configure`
 * writes from `arccms.config.json`. Every key is optional; a missing key means
 * today's behaviour: the `(default)` Firestore database, the bucket named in
 * `firebaseConfig.storageBucket`, and uploads at the bucket root.
 *
 * This module is the only place in the frontend that reads them.
 */
import { arcInstall } from '../../../environments/arc-install';

/** The id Firestore gives the database every project starts with. */
export const DEFAULT_DATABASE_ID = '(default)';

/** The shape of `arc-install.ts`, as written by `arc:configure`. */
export interface ArcInstallConfig {
    /** Firestore database id. Default `(default)`. */
    databaseId?: string;
    /** Storage bucket name (without `gs://`). Default: `firebaseConfig.storageBucket`. */
    storageBucket?: string;
    /** Folder prepended to every new upload, such as `arccms/`. Default: none. */
    storagePrefix?: string;
}

export interface ResolvedArcConfig {
    databaseId: string;
    /** `null` means the bucket from `firebaseConfig`. */
    storageBucket: string | null;
    /** Empty, or a folder ending in `/`. */
    storagePrefix: string;
}

/** Fills in the defaults and normalises what was given. */
export function resolveArcConfig(raw: ArcInstallConfig | undefined): ResolvedArcConfig {
    const bucket = raw?.storageBucket?.trim().replace(/^gs:\/\//, '').replace(/\/+$/, '');
    const prefix = (raw?.storagePrefix ?? '').trim().replace(/^\/+/, '');
    return {
        databaseId: raw?.databaseId?.trim() || DEFAULT_DATABASE_ID,
        storageBucket: bucket || null,
        storagePrefix: prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix,
    };
}

export const arcConfig: ResolvedArcConfig = resolveArcConfig(arcInstall);

/**
 * Puts a new upload's path inside the install's storage folder. A path that is
 * already inside it is returned unchanged, so re-importing an export does not
 * nest the folder twice. With no prefix configured the path is untouched.
 */
export function withStoragePrefix(path: string, prefix: string = arcConfig.storagePrefix): string {
    if (!prefix || path.startsWith(prefix)) return path;
    return `${prefix}${path.replace(/^\/+/, '')}`;
}
