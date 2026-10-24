/**
 * When this device's clock counts as wrong (docs/app/clock-and-zones.html). Arc CMS
 * ships this empty and never edits it again. Empty means 2 minutes: ArcClock.skewed()
 * turns true when the device is more than 120 seconds ahead of or behind the server.
 *
 *   export const CUSTOM_CLOCK: CustomClock = {
 *       skewSeconds: 30,   // warn sooner
 *   };
 */
import type { CustomClock } from '../app/core/time/clock-config';

export const CUSTOM_CLOCK: CustomClock = {};
