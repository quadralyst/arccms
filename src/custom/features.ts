/**
 * The Arc CMS features this app turns on or off (docs/app/custom-space.html). Arc CMS
 * ships this empty and never edits it again. Empty means every feature is on
 * except the installable app (PWA), which a plain website does not want.
 *
 *   export const CUSTOM_FEATURES: FeatureChoice = {
 *       on: ['pwa'],
 *       off: ['content', 'sms', 'payments'],
 *   };
 *
 * Off by default, turned on with `on`: pwa.
 * On by default, turned off with `off`: content, search, seo, forms, audience,
 * email-marketing, sms, payments, data. Signup forms and email marketing need
 * audience. A typo or a missing need stops `npm run dev` and `npm run build`
 * with a message saying what to change.
 */
import type { FeatureChoice } from '../app/core/features/feature-registry';

export const CUSTOM_FEATURES: FeatureChoice = {};
