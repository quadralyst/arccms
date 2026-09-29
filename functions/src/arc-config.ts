/**
 * Install configuration for the Cloud Functions (docs/coexistence-spec.md, CO-D2, CO-D3).
 *
 * Every value is optional. A missing key means today's behaviour: the `(default)`
 * Firestore database and the hosting site named after the project. An install that
 * shares its Firebase project with another app sets these in `functions/.env`
 * (written by `npm run arc:configure`). Running functions see that file in
 * `process.env`; trigger bindings, fixed at deploy time, read it through the
 * `ARC_DATABASE_ID` param instead (see `arcDatabaseParam`).
 *
 * This module is the only place in the functions that reads these variables.
 */

import { defineString, type StringParam } from 'firebase-functions/params';

/** The id Firestore gives the database every project starts with. */
export const DEFAULT_DATABASE_ID = '(default)';

type Env = Record<string, string | undefined>;

/** The Firestore database ArcCMS reads and writes. `ARC_DATABASE_ID`, default `(default)`. */
export function arcDatabaseId(env: Env = process.env): string {
    return env.ARC_DATABASE_ID?.trim() || DEFAULT_DATABASE_ID;
}

/** `ARC_HOSTING_SITE=none`: this install publishes nothing to Firebase Hosting (CO5). */
export const HOSTING_OFF = 'none';

/**
 * The Firebase Hosting site ArcCMS publishes to. `ARC_HOSTING_SITE`, default the
 * project id, which is the site every project starts with. Empty when the
 * install has hosting turned off (`ARC_HOSTING_SITE=none`): every caller treats
 * an empty site as "do not touch Hosting".
 *
 * Read at call time rather than at import, because `GCLOUD_PROJECT` is set by the
 * runtime and tests change it between cases.
 */
export function arcHostingSite(env: Env = process.env): string {
    const configured = env.ARC_HOSTING_SITE?.trim();
    if (configured === HOSTING_OFF) return '';
    return configured || env.GCLOUD_PROJECT || '';
}

/** Whether this install publishes to Firebase Hosting at all. */
export function arcHostingEnabled(env: Env = process.env): boolean {
    return arcHostingSite(env) !== '';
}

/** `https://{site}.web.app`, the hosting origin that always serves the deployed files; '' with hosting off. */
export function arcHostingOrigin(env: Env = process.env): string {
    const site = arcHostingSite(env);
    return site ? `https://${site}.web.app` : '';
}

/**
 * The Storage bucket ArcCMS files live in. `ARC_STORAGE_BUCKET`, '' for the
 * project's default bucket (`storage.bucket()` with no name).
 */
export function arcStorageBucket(env: Env = process.env): string {
    return env.ARC_STORAGE_BUCKET?.trim().replace(/^gs:\/\//, '') || '';
}

/**
 * The folder ArcCMS uploads go under. `ARC_STORAGE_PREFIX`, '' for the bucket
 * root; otherwise it ends in `/` (`arccms/`), as the browser's `storagePrefix` does.
 */
export function arcStoragePrefix(env: Env = process.env): string {
    const prefix = env.ARC_STORAGE_PREFIX?.trim().replace(/^\/+/, '') || '';
    return prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
}

/**
 * The per-user Storage folder, `{prefix}users/{userDocId}/`: apps keep a
 * person's files here, and deleting the account deletes the folder
 * (docs/account-contract.md).
 */
export function userStorageFolder(userDocId: string, env: Env = process.env): string {
    return `${arcStoragePrefix(env)}users/${userDocId}/`;
}

/**
 * The database id as a deploy-time param. Trigger bindings are decided when the
 * Firebase CLI loads this code to deploy it, and at that moment `functions/.env`
 * is NOT in `process.env`; only params are resolved from it. A plain
 * `process.env` read here deployed every trigger on `(default)` (found on the
 * dev project, 2026-09-23). At run time the same value is in `process.env`,
 * which is what `arcDatabaseId()` and `init.ts` use.
 */
export const arcDatabaseParam = defineString('ARC_DATABASE_ID', {
    default: DEFAULT_DATABASE_ID,
    description: 'Firestore database ArcCMS uses. Leave as (default) unless ArcCMS shares its Firebase project (docs/coexistence-spec.md).',
});

/**
 * Trigger options for a Firestore path in the install's database (CO3).
 * Every `onDocument*` trigger passes its path through this, so a shared-project
 * install listens on its own database and never on the host app's:
 *
 *     onDocumentCreated(arcDocument('users/{docId}'), handler)
 *     onDocumentCreated({ ...arcDocument('Jobs/{id}'), timeoutSeconds: 540 }, handler)
 *
 * With no `ARC_DATABASE_ID` this is `(default)`, the value Firebase uses anyway.
 */
export function arcDocument<Path extends string>(document: Path): { document: Path; database: StringParam } {
    return { document, database: arcDatabaseParam };
}

