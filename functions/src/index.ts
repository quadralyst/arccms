/**
 * Functions entry point (specs/coexistence-spec.md, CO-D4, CO-D5).
 *
 * Everything is exported as one group, so every ArcCMS function deploys as
 * `arccms-<name>` (for example `arccms-sendTestEmail`). A Firebase project that
 * also hosts another app's functions then has no name to clash on, and the
 * `arccms` codebase in firebase.json keeps each app's deploys from deleting the
 * other's functions. Callers use the prefixed name: the frontend through
 * `arcCallable()`, HTTP clients through the `arccms-` URL.
 */
export * as arccms from './all.js';
