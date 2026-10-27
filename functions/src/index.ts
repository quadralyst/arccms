/**
 * Functions entry point (specs/coexistence-spec.md, CO-D4, CO-D5).
 *
 * Everything is exported as one group, so every ArcCMS function deploys as
 * `arccms-<name>` (for example `arccms-sendTestEmail`). A Firebase project that
 * also hosts another app's functions then has no name to clash on, and the
 * `arccms` codebase in firebase.json keeps each app's deploys from deleting the
 * other's functions. Callers use the prefixed name: the frontend through
 * `arcCallable()`, HTTP clients through the `arccms-` URL.
 *
 * The group is all.js. An instance started for one function loads only that
 * function's file (load-functions.ts), so a cold start does not pay for every
 * other function's code (docs/app/functions.html#cold-starts).
 */
// First, so every function below is defined in the install's region.
import './region.js';
import { loadFunctions } from './load-functions.js';
import { applyKeepWarm, keepWarmSetting, parseKeepWarm } from './keep-warm.js';

const target = process.env.FUNCTION_TARGET;

export const arccms = await loadFunctions(target);

// Every function loaded: a deploy reading what to deploy, so the ones the project
// keeps running get their instances (ARC_KEEP_WARM, keep-warm.ts).
if (!target) {
    const missing = applyKeepWarm(arccms, parseKeepWarm(keepWarmSetting()));
    if (missing.length) console.warn(`ARC_KEEP_WARM names functions this build does not have: ${missing.join(', ')}.`);
}
