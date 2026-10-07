import { setGlobalOptions } from 'firebase-functions/v2';
import { arcFunctionsRegionParam } from './arc-config.js';

/**
 * Every function runs in the install's functions region (ARC_FUNCTIONS_REGION),
 * next to its database. index.ts imports this before any function is defined,
 * so no function may set a region of its own. The one first generation function,
 * onSignInDeleted, takes the same parameter itself: this setting does not reach it.
 */
setGlobalOptions({ region: arcFunctionsRegionParam });
