/**
 * The app's own Cloud Functions and triggers (docs/custom-code.md). Arc CMS ships
 * this empty and never edits it again. Everything exported here deploys as
 * `arccms-custom-<name>` (deploy one with `functions:arccms:arccms.custom.<name>`),
 * so it can never collide with a core function.
 *
 * Use the core helpers: `db` from '../init.js', and `arcDocument()` from
 * '../arc-config.js' for every Firestore trigger path.
 */
export {};
