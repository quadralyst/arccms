/**
 * Install configuration for the Cloud Functions (docs/coexistence-spec.md, CO-D2, CO-D3).
 *
 * Every value is optional. A missing key means today's behaviour: the `(default)`
 * Firestore database and the hosting site named after the project. An install that
 * shares its Firebase project with another app sets these in `functions/.env`
 * (written by `npm run arc:configure`); the Firebase CLI loads that file at deploy
 * time and at run time.
 *
 * This module is the only place in the functions that reads these variables.
 */

/** The id Firestore gives the database every project starts with. */
export const DEFAULT_DATABASE_ID = '(default)';

type Env = Record<string, string | undefined>;

/** The Firestore database ArcCMS reads and writes. `ARC_DATABASE_ID`, default `(default)`. */
export function arcDatabaseId(env: Env = process.env): string {
    return env.ARC_DATABASE_ID?.trim() || DEFAULT_DATABASE_ID;
}

/**
 * The Firebase Hosting site ArcCMS publishes to. `ARC_HOSTING_SITE`, default the
 * project id, which is the site every project starts with.
 *
 * Read at call time rather than at import, because `GCLOUD_PROJECT` is set by the
 * runtime and tests change it between cases.
 */
export function arcHostingSite(env: Env = process.env): string {
    return env.ARC_HOSTING_SITE?.trim() || env.GCLOUD_PROJECT || '';
}

/** `https://{site}.web.app`, the hosting origin that always serves the deployed files. */
export function arcHostingOrigin(env: Env = process.env): string {
    return `https://${arcHostingSite(env)}.web.app`;
}
